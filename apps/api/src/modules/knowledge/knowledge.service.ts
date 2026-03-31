import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { PoolClient } from 'pg'
import { DatabaseService } from '../database/database.service'
import { OpenAIEmbeddings } from '@langchain/openai'

// pdf-parse 的默认导出在 TS 类型里不总是可调用，因此用 require + any 规避类型问题。
const pdfParse = require('pdf-parse') as any
import * as cheerio from 'cheerio'
import mammoth from 'mammoth'
import { createWorker } from 'tesseract.js'

type IngestInput = {
  userId: string
  file?: Express.Multer.File
  url?: string
}

const CHUNK_STRATEGIES = ['semantic', 'fixed', 'paragraph'] as const
type ChunkStrategy = (typeof CHUNK_STRATEGIES)[number]

function guessSourceType({ file, url }: { file?: Express.Multer.File; url?: string }) {
  if (url) return 'url'
  if (file) return 'file'
  throw new BadRequestException('Missing file or url')
}

function normalizeChunkStrategy(raw?: string): ChunkStrategy {
  const s = (raw || 'semantic').toLowerCase()
  if (CHUNK_STRATEGIES.includes(s as ChunkStrategy)) return s as ChunkStrategy
  return 'semantic'
}

function chunkText(text: string, chunkSize: number, chunkOverlap: number) {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\s+\n/g, '\n').trim()
  if (!cleaned) return []

  const chunks: string[] = []
  let start = 0
  while (start < cleaned.length) {
    let end = Math.min(start + chunkSize, cleaned.length)
    if (end < cleaned.length) {
      const lastSpace = cleaned.lastIndexOf(' ', end)
      if (lastSpace > start + Math.floor(chunkSize * 0.6)) end = lastSpace
    }
    const chunk = cleaned.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= cleaned.length) break
    const nextStart = end - chunkOverlap
    start = nextStart > start ? nextStart : end
  }
  return chunks
}

function embedToVectorLiteral(embedding: number[]) {
  return `[${embedding.join(',')}]`
}

function getOpenAIBaseUrl() {
  return process.env.OPENAI_BASE_URL || 'https://api.minimaxi.com/v1'
}

function formatSizeText(byteLength: number | null, textChars: number | null) {
  if (byteLength != null && byteLength > 0) {
    if (byteLength < 1024) return `${byteLength} B`
    if (byteLength < 1024 * 1024) return `${(byteLength / 1024).toFixed(1)} KB`
    return `${(byteLength / (1024 * 1024)).toFixed(2)} MB`
  }
  if (textChars != null && textChars > 0) return `约 ${textChars.toLocaleString()} 字`
  return '—'
}

async function extractTextFromFile(file: Express.Multer.File) {
  const filename = file.originalname || ''
  const mime = file.mimetype || ''
  const buf = file.buffer

  if (mime.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) {
    const data = await pdfParse(buf)
    return data.text || ''
  }

  if (mime.includes('word') || filename.toLowerCase().endsWith('.docx')) {
    const data = await mammoth.extractRawText({ buffer: buf })
    return data.value || ''
  }

  if (mime.includes('html') || filename.toLowerCase().endsWith('.html') || filename.toLowerCase().endsWith('.htm')) {
    const html = buf.toString('utf-8')
    const $ = cheerio.load(html)
    return $('body').text() || $.root().text() || ''
  }

  if (mime.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(filename)) {
    return buf.toString('utf-8')
  }

  if (mime.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(filename)) {
    const worker = await createWorker('eng')
    const { data } = await worker.recognize(buf)
    await worker.terminate()
    return data.text || ''
  }

  throw new BadRequestException(`Unsupported file type: ${mime} (${filename})`)
}

async function extractTextFromUrl(url: string) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new BadRequestException(`Fetch url failed: ${res.status}`)
  const contentType = res.headers.get('content-type') || ''
  const arrayBuffer = await res.arrayBuffer()
  const buf = Buffer.from(arrayBuffer)

  if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
    const data = await pdfParse(buf)
    return data.text || ''
  }

  const html = buf.toString('utf-8')
  const $ = cheerio.load(html)
  return $('body').text() || $.root().text() || ''
}

@Injectable()
export class KnowledgeService {
  constructor(private readonly db: DatabaseService) {}

  /** 供聊天附件等场景复用，不入库、不建向量 */
  async extractTextFromBuffer(params: { buffer: Buffer; mimeType: string; originalname: string }) {
    const file = {
      buffer: params.buffer,
      mimetype: params.mimeType,
      originalname: params.originalname,
    } as Express.Multer.File
    return extractTextFromFile(file)
  }

  private async getOrCreateRagConfig(userId: string) {
    const res = await this.db.query(
      `SELECT top_k, similarity_threshold, chunk_size, chunk_overlap, chunk_strategy
       FROM rag_configs WHERE user_id = $1 LIMIT 1`,
      [userId],
    )
    if (res.rows.length > 0) return res.rows[0]

    await this.db.query(
      `INSERT INTO rag_configs (user_id, top_k, similarity_threshold, chunk_size, chunk_overlap, chunk_strategy)
       VALUES ($1, 5, 0.82, 800, 120, 'semantic')
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    )

    const after = await this.db.query(
      `SELECT top_k, similarity_threshold, chunk_size, chunk_overlap, chunk_strategy
       FROM rag_configs WHERE user_id = $1 LIMIT 1`,
      [userId],
    )
    return after.rows[0]
  }

  async ingest(input: IngestInput) {
    const { userId, file, url } = input
    const sourceType = guessSourceType({ file, url })

    const cfg = await this.getOrCreateRagConfig(userId)
    const chunkSize = Number(cfg.chunk_size ?? 800)
    const chunkOverlap = Number(cfg.chunk_overlap ?? 120)

    const text = file ? await extractTextFromFile(file) : url ? await extractTextFromUrl(url) : ''

    if (!text || text.trim().length < 50) {
      throw new BadRequestException('提取的正文过短（至少约 50 个字符），请换文件或检查 URL 内容')
    }

    const chunks = chunkText(text, chunkSize, chunkOverlap)
    if (chunks.length === 0) throw new BadRequestException('未能生成有效文本分块')

    const byteLength = file?.buffer?.length ?? null
    const textChars = text.length
    const enableEmbeddings = process.env.ENABLE_EMBEDDINGS === 'true'

    const embedModel = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small'
    const embeddings = enableEmbeddings
      ? new OpenAIEmbeddings({
          apiKey: process.env.OPENAI_API_KEY,
          model: embedModel as any,
          configuration: { baseURL: getOpenAIBaseUrl() },
        })
      : null

    const result = await this.db.transaction(async (client: PoolClient) => {
      const doc = await client.query<{ id: string }>(
        `INSERT INTO documents (user_id, source_type, source_url, original_filename, byte_length, text_chars, parsed_chunk_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [userId, sourceType, url || null, file?.originalname || null, byteLength, textChars, chunks.length],
      )
      const documentId = doc.rows[0].id

      let embedded = 0
      for (let i = 0; i < chunks.length; i++) {
        const content = chunks[i]
        const meta = {
          sourceType,
          chunkSize,
          chunkOverlap,
          embeddingsEnabled: enableEmbeddings,
        }

        if (embeddings) {
          const vec = await embeddings.embedQuery(content)
          const vectorLiteral = embedToVectorLiteral(vec)
          await client.query(
            `INSERT INTO document_chunks (document_id, user_id, chunk_index, content, metadata, embedding)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector)`,
            [documentId, userId, i, content, JSON.stringify(meta), vectorLiteral],
          )
          embedded++
        } else {
          await client.query(
            `INSERT INTO document_chunks (document_id, user_id, chunk_index, content, metadata, embedding)
             VALUES ($1, $2, $3, $4, $5::jsonb, NULL)`,
            [documentId, userId, i, content, JSON.stringify(meta)],
          )
        }
      }

      return {
        documentId,
        chunksStored: chunks.length,
        chunksEmbedded: embedded,
        sourceType,
        embeddingsEnabled: enableEmbeddings,
      }
    })

    return result
  }

  async listDocuments(userId: string, q?: string) {
    const search = (q || '').trim()
    const params: any[] = [userId]
    let whereExtra = ''
    if (search.length > 0) {
      params.push(`%${search}%`, `%${search}%`)
      whereExtra = ` AND (d.original_filename ILIKE $2 OR d.source_url ILIKE $3)`
    }

    const docs = await this.db.query<{
      id: string
      original_filename: string | null
      source_url: string | null
      source_type: string
      created_at: string
      chunk_count: string
      embedded_count: string
      byte_length: number | null
      text_chars: number | null
      parsed_chunk_count: number
    }>(
      `SELECT d.id,
              d.original_filename,
              d.source_url,
              d.source_type,
              d.created_at,
              d.byte_length,
              d.text_chars,
              d.parsed_chunk_count,
              (SELECT COUNT(*)::text FROM document_chunks dc WHERE dc.document_id = d.id) AS chunk_count,
              (SELECT COUNT(*)::text FROM document_chunks dc WHERE dc.document_id = d.id AND dc.embedding IS NOT NULL) AS embedded_count
       FROM documents d
       WHERE d.user_id = $1${whereExtra}
       ORDER BY d.created_at DESC
       LIMIT 100`,
      params,
    )

    return docs.rows.map((d) => {
      const chunkCount = Number(d.chunk_count || 0)
      const embeddedCount = Number(d.embedded_count || 0)
      let status = '已解析'
      let statusKey: 'indexed' | 'parsed' | 'empty' = 'parsed'
      if (chunkCount === 0) {
        status = '无分块'
        statusKey = 'empty'
      } else if (embeddedCount > 0) {
        status = embeddedCount === chunkCount ? '已向量化' : `向量化 ${embeddedCount}/${chunkCount}`
        statusKey = 'indexed'
      } else {
        status = '仅文本分块（未向量化）'
        statusKey = 'parsed'
      }

      return {
        id: d.id,
        filename: d.original_filename || (d.source_url ? '网页来源' : '未命名'),
        sourceUrl: d.source_url,
        sourceType: d.source_type,
        status,
        statusKey,
        chunkCount,
        embeddedChunkCount: embeddedCount,
        createdAt: d.created_at,
        dimension: embeddedCount > 0 ? 1536 : 0,
        sizeText: formatSizeText(d.byte_length, d.text_chars),
        textChars: d.text_chars,
      }
    })
  }

  async deleteDocument(userId: string, documentId: string) {
    const res = await this.db.query<{ id: string }>(
      `DELETE FROM documents WHERE id = $1 AND user_id = $2 RETURNING id`,
      [documentId, userId],
    )
    if (res.rows.length === 0) throw new NotFoundException('文档不存在或无权删除')
    return { ok: true, id: res.rows[0].id }
  }

  async listDocumentChunks(userId: string, documentId: string, limit = 30, offset = 0) {
    const own = await this.db.query(
      `SELECT 1 FROM documents WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [documentId, userId],
    )
    if (own.rows.length === 0) throw new NotFoundException('文档不存在或无权查看')

    const lim = Math.min(Math.max(Number(limit) || 30, 1), 100)
    const off = Math.max(Number(offset) || 0, 0)

    const total = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM document_chunks WHERE document_id = $1 AND user_id = $2`,
      [documentId, userId],
    )
    const chunks = await this.db.query<{
      id: string
      chunk_index: number
      content: string
      metadata: any
      has_embedding: boolean
    }>(
      `SELECT id,
              chunk_index,
              content,
              metadata,
              (embedding IS NOT NULL) AS has_embedding
       FROM document_chunks
       WHERE document_id = $1 AND user_id = $2
       ORDER BY chunk_index ASC
       LIMIT $3 OFFSET $4`,
      [documentId, userId, lim, off],
    )

    return {
      total: Number(total.rows[0]?.c || 0),
      limit: lim,
      offset: off,
      items: chunks.rows.map((r) => ({
        id: r.id,
        chunkIndex: r.chunk_index,
        content: r.content,
        metadata: r.metadata,
        embedded: r.has_embedding,
      })),
    }
  }

  async getStats(userId: string) {
    const row = await this.db.query<{
      documents: string
      from_url: string
      from_file: string
      chunks: string
      embedded_chunks: string
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM documents WHERE user_id = $1) AS documents,
         (SELECT COUNT(*)::text FROM documents WHERE user_id = $1 AND source_type = 'url') AS from_url,
         (SELECT COUNT(*)::text FROM documents WHERE user_id = $1 AND source_type = 'file') AS from_file,
         (SELECT COUNT(*)::text FROM document_chunks WHERE user_id = $1) AS chunks,
         (SELECT COUNT(*)::text FROM document_chunks WHERE user_id = $1 AND embedding IS NOT NULL) AS embedded_chunks`,
      [userId],
    )
    const r = row.rows[0]
    const embeddingsEnvEnabled = process.env.ENABLE_EMBEDDINGS === 'true'
    return {
      documents: Number(r?.documents || 0),
      fromUrl: Number(r?.from_url || 0),
      fromFile: Number(r?.from_file || 0),
      chunks: Number(r?.chunks || 0),
      embeddedChunks: Number(r?.embedded_chunks || 0),
      vectorDimensions: 1536,
      embeddingsEnvEnabled,
    }
  }

  async upsertRagConfig(userId: string, cfg: any) {
    const topK = typeof cfg?.topK === 'number' ? Math.min(20, Math.max(1, cfg.topK)) : 5
    const similarityThreshold =
      typeof cfg?.similarityThreshold === 'number'
        ? Math.min(0.99, Math.max(0.3, cfg.similarityThreshold))
        : 0.82
    const chunkSize = typeof cfg?.chunkSize === 'number' ? Math.min(4000, Math.max(200, cfg.chunkSize)) : 800
    const chunkOverlap = typeof cfg?.chunkOverlap === 'number' ? Math.max(0, cfg.chunkOverlap) : 120
    const safeOverlap =
      chunkOverlap < chunkSize ? chunkOverlap : Math.max(0, Math.floor(chunkSize * 0.15))
    const chunkStrategy = normalizeChunkStrategy(cfg?.chunkStrategy)

    await this.db.query(
      `INSERT INTO rag_configs (user_id, top_k, similarity_threshold, chunk_size, chunk_overlap, chunk_strategy)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id)
       DO UPDATE SET
         top_k = EXCLUDED.top_k,
         similarity_threshold = EXCLUDED.similarity_threshold,
         chunk_size = EXCLUDED.chunk_size,
         chunk_overlap = EXCLUDED.chunk_overlap,
         chunk_strategy = EXCLUDED.chunk_strategy,
         updated_at = NOW()`,
      [userId, topK, similarityThreshold, chunkSize, safeOverlap, chunkStrategy],
    )

    return this.getRagConfig(userId)
  }

  async getRagConfig(userId: string) {
    const res = await this.db.query(
      `SELECT top_k AS "topK",
              similarity_threshold AS "similarityThreshold",
              chunk_size AS "chunkSize",
              chunk_overlap AS "chunkOverlap",
              chunk_strategy AS "chunkStrategy"
       FROM rag_configs
       WHERE user_id = $1
       LIMIT 1`,
      [userId],
    )
    if (res.rows.length === 0) {
      const created = await this.getOrCreateRagConfig(userId)
      return {
        topK: Number(created.top_k),
        similarityThreshold: Number(created.similarity_threshold),
        chunkSize: Number(created.chunk_size),
        chunkOverlap: Number(created.chunk_overlap),
        chunkStrategy: String(created.chunk_strategy || 'semantic'),
      }
    }
    const row = res.rows[0] as any
    return {
      ...row,
      chunkStrategy: normalizeChunkStrategy(row.chunkStrategy),
    }
  }
}
