import { BadRequestException, Injectable } from '@nestjs/common'
import { OpenAIEmbeddings } from '@langchain/openai'
import OpenAI from 'openai'

import { DatabaseService } from '../database/database.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import {
  createAssistantVisibleStreamFilter,
  extractStreamContentDelta,
} from './stream-thinking.util'

function vectorLiteral(embedding: number[]) {
  return `[${embedding.join(',')}]`
}

function getOpenAIBaseUrl() {
  return process.env.OPENAI_BASE_URL || 'https://api.minimaxi.com/v1'
}

function isMiniMaxGateway(baseUrl: string) {
  // 官方文档多为 api.minimax.io；仓库默认也常见 api.minimaxi.com
  return /(?:minimaxi\.com|minimax\.io|minimax\.com)/i.test(baseUrl)
}

function buildSystemPrompt(hasReferenceMaterial: boolean, hasUserImages: boolean) {
  const common = [
    '你是 Digital Curator（数字策展 AI），协助用户理解业务数据、知识库与对话上下文。',
    '请始终使用**简体中文**回复：语气专业、清晰、友好。',
    '回答尽量结构化：必要时使用小标题与列表；优先给出可直接执行的结论，再补充依据与注意点。',
    '【输出纪律】禁止输出任何思考过程、内心独白、自我规划或对「系统提示 / 用户原话」的复述分析。',
    '禁止以「用户只是…」「根据系统提示…」「对于这种…我需要…」等元话语开头；请**直接**输出面向用户的正文（例如问候场景下直接说「您好！我是…」）。',
    '不要描述「当前有没有参考资料」这类后台状态，除非用户明确问知识库是否可用；没有资料时像普通助手一样自然回答即可。',
    '【结构化看板（可选）】当用户问题涉及经营/销售/毛利/区域对比等数据分析时，在自然语言回答之后，**另起一段**输出**唯一一个** Markdown JSON 代码块（语言标记写 json），供前端渲染看板。JSON 须为合法 UTF-8 JSON，键名固定：',
    '`schema` 固定字符串 "chat_insight_v1"；`summary`（可选，字符串，一句话摘要）；`kpis`（可选，数组，元素含 label、value、delta、positive 布尔）；`salesRows`（可选，数组，元素含 region、amount、ratio、trend 取值仅能为「上涨」「下降」「稳定」）；`followUps`（可选，数组，2~4 条中文追问）。',
    '除该代码块外不要用重复字段罗列同样指标；若无法给出可靠数据则不要输出该 JSON 块。',
  ]

  if (hasUserImages) {
    common.push(
      '用户可能附带**图片**。请结合图片与文字作答：描述关键视觉信息、图表数据或界面文字；若分辨率不足或无法辨认，请如实说明并基于可见部分推断。',
    )
  }

  if (hasReferenceMaterial) {
    return [
      ...common,
      '本轮附带「参考资料」。请**优先且严格基于这些资料**作答；概括引用即可，避免大段照抄。',
      '若资料不足以严谨回答：明确说明「根据当前资料无法确定……」，列出缺失信息；不要编造资料中不存在的事实、数字或来源。',
      '可在资料之外补充**通识级**背景，但必须标注为「通用说明」且不与资料矛盾。',
    ].join('\n')
  }

  return [
    ...common,
    '当前**没有**可用的知识库检索片段（或未开启向量检索）。请作为可靠助手作答：保持事实准确，不虚构内部数据。',
    '若问题依赖用户私有数据而上下文中没有：说明限制并引导用户补充；不要假装引用不存在的「资料」或文件。',
  ].join('\n')
}

function buildUserTurnContent(message: string, context: string) {
  const ctx = context.trim()
  if (ctx) {
    return ['【参考资料】（供本轮使用）', ctx, '', '【用户问题】', message].join('\n')
  }
  return ['【用户问题】', message].join('\n')
}

function truncateMessageContent(text: string, maxChars: number) {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n…（历史消息已截断）`
}

function buildContext(docs: Array<{ content: string; metadata: any }>) {
  // Limit context size to avoid token overflow.
  const maxChars = 6000
  const parts: string[] = []
  let total = 0
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    const header = `【${i + 1}】来源：${d.metadata?.sourceType || 'unknown'}`
    const body = d.content
    const piece = `${header}\n${body}`
    if (total + piece.length > maxChars) break
    parts.push(piece)
    total += piece.length
  }
  return parts.join('\n\n')
}

const DEFAULT_SESSION_TITLES = ['新会话', '智能对话会话', 'New Session']

export function mapChatModelForProvider(requestedModel?: string) {
  // Frontend exposes: gpt-4o / gpt-4o-mini.
  // When using OpenAI official gateway, pass through model names directly.
  // When using MiniMax OpenAI-compatible gateway, map to MiniMax model ids.
  const baseUrl = getOpenAIBaseUrl()
  if (!isMiniMaxGateway(baseUrl)) return requestedModel || 'gpt-4o'

  const allowedModels = (process.env.ALLOWED_CHAT_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // MiniMax 网关下：当用户传入 gpt-4o / gpt-4o-mini 时，优先映射到当前允许列表，
  // 避免默认落到不在 token plan 支持范围内的 MiniMax-M2.7。
  if (requestedModel === 'gpt-4o') {
    return process.env.MINIMAX_MODEL_GPT_4O || allowedModels[0] || 'MiniMax-M2.7'
  }
  if (requestedModel === 'gpt-4o-mini') {
    return process.env.MINIMAX_MODEL_GPT_4O_MINI || allowedModels[1] || allowedModels[0] || 'MiniMax-M2.7-highspeed'
  }

  // 若前端直接传 MiniMax 模型 id，则直接透传。
  return requestedModel || allowedModels[0] || 'MiniMax-M2.7'
}

export type ChatStreamAttachmentInput = {
  kind: 'image' | 'file'
  name: string
  mimeType: string
  base64: string
}

@Injectable()
export class ChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly knowledge: KnowledgeService,
  ) {}

  getChatConfig() {
    const raw = process.env.ALLOWED_CHAT_MODELS || 'gpt-4o,gpt-4o-mini'
    const models = raw.split(',').map((s) => s.trim()).filter(Boolean)
    const maxMessageChars = Math.min(
      200_000,
      Math.max(500, parseInt(process.env.CHAT_MAX_MESSAGE_CHARS || '24000', 10) || 24000),
    )
    const envDefault = (process.env.CHAT_DEFAULT_MODEL || '').trim()
    const defaultModel = envDefault && models.includes(envDefault) ? envDefault : models[0] || ''
    return {
      models,
      defaultModel,
      maxMessageChars,
      embeddingsEnabled: process.env.ENABLE_EMBEDDINGS === 'true',
    }
  }

  async updateSessionTitle(userId: string, sessionId: string, title: string) {
    const t = title.trim()
    if (t.length < 1 || t.length > 128) throw new BadRequestException('标题长度需在 1～128 字符')
    const res = await this.db.query<{ id: string }>(
      `UPDATE chat_sessions SET title = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id`,
      [t, sessionId, userId],
    )
    if (res.rows.length === 0) throw new BadRequestException('Session not found')
  }

  async deleteSession(userId: string, sessionId: string) {
    const res = await this.db.query<{ id: string }>(
      `DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2 RETURNING id`,
      [sessionId, userId],
    )
    if (res.rows.length === 0) throw new BadRequestException('Session not found')
  }

  private async touchSessionUpdatedAt(sessionId: string) {
    await this.db.query(`UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`, [sessionId])
  }

  /** 默认标题的会话在首条用户消息后自动改为首句摘要 */
  private async maybeAutoTitleFromFirstMessage(sessionId: string, userId: string, message: string) {
    const snippet = message.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (snippet.length < 2) return
    await this.db.query(
      `UPDATE chat_sessions
       SET title = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
         AND title = ANY($4::text[])
         AND (
           SELECT COUNT(*)::int FROM chat_messages
           WHERE session_id = $2 AND role = 'user'
         ) = 1`,
      [snippet, sessionId, userId, DEFAULT_SESSION_TITLES],
    )
  }

  async listSessions(userId: string) {
    const res = await this.db.query<{
      id: string
      title: string
      created_at: string
      updated_at: string
    }>(
      `SELECT id, title, created_at, updated_at
       FROM chat_sessions
       WHERE user_id = $1 AND archived_at IS NULL
       ORDER BY updated_at DESC
       LIMIT 50`,
      [userId],
    )
    return res.rows
  }

  /** 用于深链打开已归档会话等场景（列表接口不返回 archived 行） */
  async getSessionBrief(userId: string, sessionId: string) {
    const res = await this.db.query<{
      id: string
      title: string
      created_at: string
      updated_at: string
      archived_at: string | null
    }>(
      `SELECT id, title, created_at, updated_at, archived_at
       FROM chat_sessions
       WHERE id = $1::uuid AND user_id = $2::uuid
       LIMIT 1`,
      [sessionId, userId],
    )
    if (res.rows.length === 0) return null
    const r = res.rows[0]
    return {
      id: r.id,
      title: r.title,
      created_at: r.created_at,
      updated_at: r.updated_at,
      archived: r.archived_at != null,
    }
  }

  async createSession(userId: string, title?: string) {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO chat_sessions (user_id, title)
       VALUES ($1, $2)
       RETURNING id`,
      [userId, title || '新会话'],
    )
    return { id: res.rows[0].id }
  }

  async listMessages(userId: string, sessionId: string) {
    // Ensure session belongs to user
    const owns = await this.db.query<{ id: string }>(
      'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1',
      [sessionId, userId],
    )
    if (owns.rows.length === 0) throw new BadRequestException('Session not found')

    const res = await this.db.query<{ id: string; role: string; content: string; created_at: string }>(
      `SELECT id, role, content, created_at
       FROM chat_messages
       WHERE session_id = $1
       ORDER BY created_at ASC
       LIMIT 200`,
      [sessionId],
    )
    return res.rows
  }

  private async getRagConfig(userId: string) {
    const res = await this.db.query<{
      top_k: number
      similarity_threshold: number
      chunk_size: number
      chunk_overlap: number
    }>(
      `SELECT top_k, similarity_threshold, chunk_size, chunk_overlap
       FROM rag_configs WHERE user_id = $1 LIMIT 1`,
      [userId],
    )
    if (res.rows.length > 0) return res.rows[0]
    return { top_k: 5, similarity_threshold: 0.82, chunk_size: 800, chunk_overlap: 120 }
  }

  private async ensureSession(userId: string, sessionId?: string) {
    if (sessionId) return sessionId
    const created = await this.createSession(userId, '新会话')
    return created.id
  }

  /** 读取会话内已有消息，用于多轮对话（不含本轮尚未写入的用户消息） */
  private async loadRecentTurnsForPrompt(userId: string, sessionId: string, maxMessages: number) {
    const owns = await this.db.query<{ id: string }>(
      'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1',
      [sessionId, userId],
    )
    if (owns.rows.length === 0) throw new BadRequestException('Session not found')

    const res = await this.db.query<{ role: string; content: string }>(
      `SELECT role, content FROM chat_messages
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId],
    )

    const rows = res.rows.filter(
      (r) =>
        (r.role === 'user' || r.role === 'assistant') &&
        typeof r.content === 'string' &&
        r.content.trim().length > 0,
    )

    const slice = rows.slice(-maxMessages)
    const cap = 3600
    return slice.map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: truncateMessageContent(r.content, cap),
    }))
  }

  private async retrieveChunks(userId: string, query: string, topK: number, similarityThreshold: number) {
    // Stability switch: 可在遇到 embeddings provider 兼容性问题（解析失败 / OOM）时关闭向量检索。
    if (process.env.ENABLE_EMBEDDINGS !== 'true') return []

    const embeddingsModel = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small'
    const embeddings = new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
      model: embeddingsModel as any,
      configuration: {
        baseURL: getOpenAIBaseUrl(),
      },
    })
    const queryVec = await embeddings.embedQuery(query)
    const q = vectorLiteral(queryVec)

    const res = await this.db.query<{
      content: string
      metadata: any
      similarity: number
    }>(
      `SELECT content, metadata,
              1 - (embedding <=> $1::vector) AS similarity
       FROM document_chunks
       WHERE user_id = $2
         AND embedding IS NOT NULL
         AND 1 - (embedding <=> $1::vector) >= $3
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      [q, userId, similarityThreshold, topK],
    )

    return res.rows
  }

  private async prepareChatAttachments(attachments: ChatStreamAttachmentInput[] | undefined) {
    const raw = attachments?.filter(Boolean) ?? []
    if (raw.length === 0) return { images: [] as Array<{ name: string; mimeType: string; dataUrl: string }>, fileExtracts: [] as Array<{ name: string; text: string }> }
    if (raw.length > 8) throw new BadRequestException('附件过多（最多 8 个）')

    const images: Array<{ name: string; mimeType: string; dataUrl: string }> = []
    const fileExtracts: Array<{ name: string; text: string }> = []
    let totalBytes = 0

    for (const a of raw) {
      const name = (a.name || '未命名').slice(0, 240)
      const mimeType = (a.mimeType || '').trim()
      if (!mimeType) throw new BadRequestException(`附件「${name}」缺少 mimeType`)
      if (typeof a.base64 !== 'string' || !a.base64.trim()) {
        throw new BadRequestException(`附件「${name}」内容无效`)
      }
      const b64clean = a.base64.replace(/\s/g, '')

      let buf: Buffer
      try {
        buf = Buffer.from(b64clean, 'base64')
      } catch {
        throw new BadRequestException(`附件「${name}」Base64 无效`)
      }
      if (buf.length === 0) throw new BadRequestException(`附件「${name}」为空`)
      if (buf.length > 12 * 1024 * 1024) {
        throw new BadRequestException(`附件「${name}」单文件不能超过 12MB`)
      }
      totalBytes += buf.length
      if (totalBytes > 16 * 1024 * 1024) throw new BadRequestException('附件总大小不能超过 16MB')

      if (a.kind === 'image') {
        if (images.length >= 6) throw new BadRequestException('图片附件最多 6 张')
        if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(mimeType)) {
          throw new BadRequestException(`不支持的图片类型: ${mimeType}`)
        }
        const mt = /^image\/jpe?g$/i.test(mimeType) ? 'image/jpeg' : mimeType.toLowerCase()
        images.push({ name, mimeType: mt, dataUrl: `data:${mt};base64,${b64clean}` })
      } else {
        if (fileExtracts.length >= 4) throw new BadRequestException('文件附件最多 4 个')
        try {
          const text = await this.knowledge.extractTextFromBuffer({
            buffer: buf,
            mimeType,
            originalname: name,
          })
          const cleaned = (text || '').trim()
          fileExtracts.push({
            name,
            text: cleaned.slice(0, 120_000) || '(未能抽取到文本)',
          })
        } catch (e: any) {
          fileExtracts.push({
            name,
            text: `[解析失败] ${String(e?.message || e || 'unknown')}`,
          })
        }
      }
    }

    return { images, fileExtracts }
  }

  /**
   * MiniMax 的 OpenAI 兼容接口不支持图片输入；在仍使用 MiniMax 做主对话时，
   * 通过独立的多模态网关先产出文字描述，再交给主模型。
   *
   * 配置优先级（任选其一即可启用图片）：
   * - 推荐：仅设 `OPENAI_VISION_API_KEY`（OpenAI 官方 sk-…），默认走 `https://api.openai.com/v1`。
   * - 完整：`OPENAI_IMAGE_CAPTION_BASE_URL` + `OPENAI_IMAGE_CAPTION_API_KEY`（或其它兼容 vision 的网关）。
   */
  private async captionImagesForMiniMaxBeforeChat(opts: {
    images: Array<{ name: string; mimeType: string; dataUrl: string }>
    userHint: string
    abortSignal: AbortSignal
  }): Promise<string> {
    const explicitBase = (process.env.OPENAI_IMAGE_CAPTION_BASE_URL || '').trim()
    const explicitKey = (process.env.OPENAI_IMAGE_CAPTION_API_KEY || '').trim()
    const visionOnlyKey = (process.env.OPENAI_VISION_API_KEY || '').trim()

    const apiKey = explicitKey || visionOnlyKey
    let baseURL = explicitBase
    if (!baseURL && apiKey) {
      baseURL = 'https://api.openai.com/v1'
    }

    if (!baseURL || !apiKey) {
      throw new BadRequestException(
        '当前主对话走 MiniMax 兼容网关时，该网关不支持直接传图片。请至少配置其一：① `OPENAI_VISION_API_KEY`（OpenAI 官方密钥，用于看图并生成描述）；或 ② `OPENAI_IMAGE_CAPTION_BASE_URL` + `OPENAI_IMAGE_CAPTION_API_KEY`（任意支持 image_url 的兼容地址）。可选：`OPENAI_IMAGE_CAPTION_MODEL` / `OPENAI_VISION_MODEL`（默认 gpt-4o-mini）。',
      )
    }
    if (isMiniMaxGateway(baseURL)) {
      throw new BadRequestException(
        '图片理解所用的 BASE_URL 不能指向 MiniMax；请使用支持图片输入的视觉模型地址（未显式配置时请检查是否误把 OPENAI_IMAGE_CAPTION_BASE_URL 设成了 MiniMax）。',
      )
    }
    const model = (
      process.env.OPENAI_IMAGE_CAPTION_MODEL ||
      process.env.OPENAI_VISION_MODEL ||
      'gpt-4o-mini'
    ).trim()
    const client = new OpenAI({ apiKey, baseURL })
    const userLine =
      opts.userHint.trim() ||
      '用户上传了图片但未输入额外文字，请根据图片内容客观描述并提炼要点，便于后续模型作答。'
    const content: OpenAI.Chat.ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: `${userLine}\n\n请用简体中文、分条描述每张图片中的关键信息（可读文字、数据、图表、界面与场景）。无法辨认处请如实说明。`,
      },
      ...opts.images.map((im) => ({
        type: 'image_url' as const,
        image_url: { url: im.dataUrl },
      })),
    ]
    const resp = await client.chat.completions.create(
      {
        model,
        messages: [{ role: 'user', content }],
        temperature: 0.2,
        max_tokens: 2048,
      } as any,
      { signal: opts.abortSignal },
    )
    const text = (resp.choices[0]?.message?.content || '').trim()
    if (!text) {
      throw new BadRequestException(
        '视觉模型未返回图片描述。请检查 OPENAI_IMAGE_CAPTION_MODEL 是否支持多模态，或稍后重试。',
      )
    }
    return text
  }

  async streamAnswer(opts: {
    userId: string
    sessionId?: string
    message: string
    model?: string
    attachments?: ChatStreamAttachmentInput[]
    abortSignal: AbortSignal
    onMeta?: (payload: {
      sessionId: string
      ragChunkCount: number
      userMessageId: string
      imageCount?: number
      fileCount?: number
    }) => void
    onToken: (token: string) => void
    onDone: (payload: any) => void
  }) {
    const { userId, message, abortSignal, onToken, onDone, onMeta } = opts

    const trimmedMsg = (message || '').trim()
    const { images: preparedImages, fileExtracts } = await this.prepareChatAttachments(opts.attachments)
    const attachedImageCount = preparedImages.length
    let imagesForApi = [...preparedImages]
    if (!trimmedMsg && preparedImages.length === 0 && fileExtracts.length === 0) {
      throw new BadRequestException('消息与附件不能同时为空')
    }

    const cfg = this.getChatConfig()

    let persistedUser = trimmedMsg
    if (preparedImages.length) {
      persistedUser +=
        (persistedUser ? '\n' : '') + preparedImages.map((i) => `[图片: ${i.name}]`).join(' ')
    }
    for (const f of fileExtracts) {
      persistedUser += `\n\n[文件 ${f.name}]\n${f.text.slice(0, 8000)}`
    }
    if (persistedUser.length > cfg.maxMessageChars) {
      persistedUser = `${persistedUser.slice(0, cfg.maxMessageChars)}\n…（已截断）`
    }

    const allowedModels = cfg.models.length ? cfg.models : []
    const requestedModel =
      opts.model && allowedModels.includes(opts.model)
        ? opts.model
        : cfg.defaultModel || allowedModels[0] || 'gpt-4o'
    const model = mapChatModelForProvider(requestedModel)
    const baseURL = getOpenAIBaseUrl()
    const keySuffix = (process.env.OPENAI_API_KEY || '').slice(-6)
    // eslint-disable-next-line no-console
    console.log(`[chat] provider baseURL=${baseURL} model=${model} keySuffix=${keySuffix || 'EMPTY'}`)

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL,
    })

    const sessionId = await this.ensureSession(userId, opts.sessionId)

    const historyLimit = Math.min(
      32,
      Math.max(4, parseInt(process.env.CHAT_HISTORY_MESSAGES || '20', 10) || 20),
    )
    const history = await this.loadRecentTurnsForPrompt(userId, sessionId, historyLimit)

    const ragCfg = await this.getRagConfig(userId)
    const topK = ragCfg.top_k
    const similarityThreshold = ragCfg.similarity_threshold

    const ragQueryParts = [trimmedMsg]
    for (const f of fileExtracts) ragQueryParts.push(f.text.slice(0, 1200))
    const ragQuery = ragQueryParts.filter(Boolean).join('\n').slice(0, 8000) || '附件内容'

    let chunks: Array<{ content: string; metadata: any }>
    try {
      chunks = await this.retrieveChunks(userId, ragQuery, topK, similarityThreshold)
    } catch {
      chunks = []
    }
    const context = buildContext(chunks)
    const hasReferenceMaterial = chunks.length > 0 && context.trim().length > 0

    const questionLine = trimmedMsg || '请结合我上传的图片与文件回答。'
    let userTurn = buildUserTurnContent(questionLine, context)
    if (fileExtracts.length) {
      const appendix = fileExtracts.map((f) => `《${f.name}》\n${f.text}`).join('\n\n---\n\n')
      userTurn = `【用户上传的文件全文】\n${appendix}\n\n` + userTurn
    }

    if (isMiniMaxGateway(baseURL) && imagesForApi.length > 0) {
      const caption = await this.captionImagesForMiniMaxBeforeChat({
        images: imagesForApi,
        userHint: questionLine,
        abortSignal,
      })
      userTurn = `【图片描述（自动识别）】\n${caption}\n\n` + userTurn
      imagesForApi = []
    }

    const system = buildSystemPrompt(hasReferenceMaterial, attachedImageCount > 0)
    const lastUser: OpenAI.Chat.ChatCompletionMessageParam =
      imagesForApi.length > 0
        ? {
            role: 'user',
            content: [
              { type: 'text', text: userTurn },
              ...imagesForApi.map((im) => ({
                type: 'image_url' as const,
                image_url: { url: im.dataUrl },
              })),
            ],
          }
        : { role: 'user', content: userTurn }

    const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      lastUser,
    ]

    const userMsg = await this.db.query<{ id: string }>(
      `INSERT INTO chat_messages (session_id, role, content)
       VALUES ($1, 'user', $2)
       RETURNING id`,
      [sessionId, persistedUser],
    )

    await this.touchSessionUpdatedAt(sessionId)
    const titleSeed =
      trimmedMsg ||
      preparedImages.map((i) => i.name).join('、') ||
      fileExtracts[0]?.name ||
      '附件'
    await this.maybeAutoTitleFromFirstMessage(sessionId, userId, titleSeed)

    onMeta?.({
      sessionId,
      ragChunkCount: chunks.length,
      userMessageId: userMsg.rows[0].id,
      imageCount: attachedImageCount,
      fileCount: fileExtracts.length,
    })

    const temperature = hasReferenceMaterial
      ? parseFloat(process.env.CHAT_TEMPERATURE_RAG || '0.35')
      : parseFloat(process.env.CHAT_TEMPERATURE_GENERAL || '0.65')

    const maxCompletionTokens = Math.min(
      8192,
      Math.max(256, parseInt(process.env.CHAT_MAX_COMPLETION_TOKENS || '3072', 10) || 3072),
    )

    // MiniMax：reasoning_split 易导致 delta 正文与思考字段分离，默认关闭；需时设 MINIMAX_REASONING_SPLIT=true
    const useReasoningSplit = process.env.MINIMAX_REASONING_SPLIT === 'true'

    const assistantRawChunks: string[] = []
    const visibleFilter = createAssistantVisibleStreamFilter()
    const streamContentState = { last: '', minimax: isMiniMaxGateway(baseURL) }

    const stream = await openai.chat.completions.create(
      {
        model: model as any,
        messages: chatMessages,
        temperature: Number.isFinite(temperature) ? temperature : 0.55,
        max_completion_tokens: maxCompletionTokens,
        stream: true,
        ...(useReasoningSplit ? { reasoning_split: true } : {}),
      } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal: abortSignal },
    )

    const messageIdRow = await this.db.query<{ id: string }>(
      `INSERT INTO chat_messages (session_id, role, content)
       VALUES ($1, 'assistant', '')
       RETURNING id`,
      [sessionId],
    )
    const assistantMessageId = messageIdRow.rows[0].id

    try {
      for await (const chunk of stream as any) {
        const delta = chunk?.choices?.[0]?.delta
        const piece = extractStreamContentDelta(delta, streamContentState)
        if (!piece) continue
        assistantRawChunks.push(piece)
        const rawSoFar = assistantRawChunks.join('')
        const visibleDelta = visibleFilter.pushFromAccumulated(rawSoFar)
        if (visibleDelta.length > 0) onToken(visibleDelta)
      }
    } catch (e) {
      const partialRaw = assistantRawChunks.join('')
      const partialVisible = visibleFilter.finalize(partialRaw)
      await this.db.query('UPDATE chat_messages SET content = $1 WHERE id = $2', [
        partialVisible,
        assistantMessageId,
      ])
      await this.touchSessionUpdatedAt(sessionId)
      throw e
    }

    const finalRaw = assistantRawChunks.join('')
    const final = visibleFilter.finalize(finalRaw)
    await this.db.query('UPDATE chat_messages SET content = $1 WHERE id = $2', [final, assistantMessageId])
    await this.touchSessionUpdatedAt(sessionId)

    onDone({
      messageId: assistantMessageId,
      sessionId,
      chunkCount: chunks.length,
      userMessageId: userMsg.rows[0].id,
    })

    return {
      messageId: assistantMessageId,
      sessionId,
      assistantMessage: final,
      userMessageId: userMsg.rows[0].id,
    }
  }
}

