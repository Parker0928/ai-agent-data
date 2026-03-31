import { Injectable, NotFoundException } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'

export type MarketAgentDto = {
  id: string
  category: string
  name: string
  description: string
  rating: number
  tags: string[]
  iconKey: string
  sortOrder: number
  isFeatured: boolean
  welcomeHint: string | null
  suggestedModel: string | null
  pinned: boolean
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((t) => String(t))
  if (raw && typeof raw === 'object') return []
  return []
}

function mapAgentRow(r: {
  id: string
  category: string
  name: string
  description: string
  rating: string | number
  tags: unknown
  icon_key: string
  sort_order: string | number
  is_featured: boolean
  welcome_hint: string | null
  suggested_model: string | null
  pinned?: boolean
}): MarketAgentDto {
  return {
    id: r.id,
    category: r.category,
    name: r.name,
    description: r.description,
    rating: Number(r.rating),
    tags: parseTags(r.tags),
    iconKey: r.icon_key || 'smart_toy',
    sortOrder: Number(r.sort_order),
    isFeatured: Boolean(r.is_featured),
    welcomeHint: r.welcome_hint,
    suggestedModel: r.suggested_model,
    pinned: Boolean(r.pinned),
  }
}

@Injectable()
export class MarketService {
  constructor(private readonly db: DatabaseService) {}

  private async buildEnterpriseFeature(userId: string, catalogSize: number, pinnedSize: number) {
    const stats = await this.db.query<{ docs: string; chunks: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM documents WHERE user_id = $1::uuid) AS docs,
         (SELECT COUNT(*)::text FROM document_chunks WHERE user_id = $1::uuid) AS chunks`,
      [userId],
    )
    const docs = Number(stats.rows[0]?.docs || 0)
    const chunks = Number(stats.rows[0]?.chunks || 0)
    return {
      title: `已上线 ${catalogSize} 个智能体能力`,
      body: `当前账号已置顶 ${pinnedSize} 个常用智能体，知识库累计 ${docs} 份文档 / ${chunks} 个分块。可继续按业务场景扩展企业工作流。`,
      primaryCta: '联系专家',
      secondaryCta: '查看案例',
    }
  }

  private buildKnowledgeHub(catalog: MarketAgentDto[]) {
    const tagSet = new Set<string>()
    for (const a of catalog) {
      for (const t of a.tags || []) {
        const v = String(t || '').trim()
        if (!v) continue
        tagSet.add(v)
        if (tagSet.size >= 6) break
      }
      if (tagSet.size >= 6) break
    }
    const topCategory = catalog[0]?.category || '通用'
    return {
      title: `知识智能管家 · ${topCategory}优先`,
      body: '以下标签来自当前市场目录与已上架能力，可作为知识库建设与问答提示词设计的优先参考。',
      tags: Array.from(tagSet).slice(0, 6),
    }
  }

  async listCategories() {
    const res = await this.db.query<{ category: string }>(
      `SELECT DISTINCT category FROM market_agents ORDER BY category ASC`,
    )
    return res.rows.map((r) => r.category)
  }

  async listPinnedIds(userId: string) {
    const res = await this.db.query<{ agent_id: string }>(
      `SELECT agent_id FROM user_market_agent_pins WHERE user_id = $1 ORDER BY pinned_at DESC`,
      [userId],
    )
    return res.rows.map((r) => r.agent_id)
  }

  async getCatalog(userId: string, filters: { category?: string; q?: string }) {
    const category = (filters.category || '').trim() || null
    const q = (filters.q || '').trim() || null

    const rows = await this.db.query<{
      id: string
      category: string
      name: string
      description: string
      rating: string | number
      tags: unknown
      icon_key: string
      sort_order: string | number
      is_featured: boolean
      welcome_hint: string | null
      suggested_model: string | null
      pinned: boolean
    }>(
      `SELECT m.id, m.category, m.name, m.description, m.rating, m.tags, m.icon_key, m.sort_order,
              m.is_featured, m.welcome_hint, m.suggested_model,
              (p.agent_id IS NOT NULL) AS pinned
       FROM market_agents m
       LEFT JOIN user_market_agent_pins p ON p.agent_id = m.id AND p.user_id = $1::uuid
       WHERE ($2::text IS NULL OR m.category = $2)
         AND (
           $3::text IS NULL OR
           m.name ILIKE '%' || $3 || '%' OR
           m.description ILIKE '%' || $3 || '%' OR
           m.category ILIKE '%' || $3 || '%' OR
           m.tags::text ILIKE '%' || $3 || '%'
         )
       ORDER BY pinned DESC, m.sort_order ASC, m.name ASC`,
      [userId, category, q],
    )

    return rows.rows.map((r) => mapAgentRow(r))
  }

  async getAgent(userId: string, agentId: string) {
    const res = await this.db.query<{
      id: string
      category: string
      name: string
      description: string
      rating: string | number
      tags: unknown
      icon_key: string
      sort_order: string | number
      is_featured: boolean
      welcome_hint: string | null
      suggested_model: string | null
      pinned: boolean
    }>(
      `SELECT m.id, m.category, m.name, m.description, m.rating, m.tags, m.icon_key, m.sort_order,
              m.is_featured, m.welcome_hint, m.suggested_model,
              EXISTS (SELECT 1 FROM user_market_agent_pins p WHERE p.agent_id = m.id AND p.user_id = $2::uuid) AS pinned
       FROM market_agents m
       WHERE m.id = $1
       LIMIT 1`,
      [agentId, userId],
    )
    if (res.rows.length === 0) throw new NotFoundException('智能体不存在')
    return mapAgentRow(res.rows[0])
  }

  async getMarketPayload(userId: string, filters: { category?: string; q?: string }) {
    const [catalog, categories, pinnedIds] = await Promise.all([
      this.getCatalog(userId, filters),
      this.listCategories(),
      this.listPinnedIds(userId),
    ])

    const enterpriseFeature = await this.buildEnterpriseFeature(userId, catalog.length, pinnedIds.length)
    const knowledgeHub = this.buildKnowledgeHub(catalog)

    return {
      catalog,
      categories,
      pinnedIds,
      enterpriseFeature,
      knowledgeHub,
    }
  }

  async pinAgent(userId: string, agentId: string) {
    const exists = await this.db.query(`SELECT 1 FROM market_agents WHERE id = $1 LIMIT 1`, [agentId])
    if (exists.rows.length === 0) throw new NotFoundException('智能体不存在')
    await this.db.query(
      `INSERT INTO user_market_agent_pins (user_id, agent_id) VALUES ($1::uuid, $2)
       ON CONFLICT DO NOTHING`,
      [userId, agentId],
    )
    return { ok: true, agentId }
  }

  async unpinAgent(userId: string, agentId: string) {
    const res = await this.db.query(`DELETE FROM user_market_agent_pins WHERE user_id = $1::uuid AND agent_id = $2 RETURNING agent_id`, [
      userId,
      agentId,
    ])
    if (res.rows.length === 0) return { ok: true, agentId, removed: false }
    return { ok: true, agentId, removed: true }
  }
}
