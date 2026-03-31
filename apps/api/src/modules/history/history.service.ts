import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'

export type HistoryListFilter = {
  q?: string
  /** 近 N 天内有更新；0 或缺省表示不限 */
  days?: number
  /** active | archived | all */
  scope?: string
  page?: number
  limit?: number
}

function normalizeScope(raw?: string): 'active' | 'archived' | 'all' {
  const s = (raw || 'active').toLowerCase()
  if (s === 'archived' || s === 'all') return s
  return 'active'
}

function parseUuidList(ids: unknown, max = 50): string[] {
  if (!Array.isArray(ids)) throw new BadRequestException('ids 须为非空数组')
  const list = ids.map((x) => String(x).trim()).filter(Boolean)
  if (list.length === 0) throw new BadRequestException('请至少选择一个会话')
  if (list.length > max) throw new BadRequestException(`一次最多操作 ${max} 条会话`)
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  for (const id of list) {
    if (!uuidRe.test(id)) throw new BadRequestException(`非法会话 id：${id}`)
  }
  return list
}

@Injectable()
export class HistoryService {
  constructor(private readonly db: DatabaseService) {}

  async getStats(userId: string) {
    const res = await this.db.query<{
      total: string
      active: string
      archived: string
      updated_7d: string
      messages_total: string
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE archived_at IS NULL)::text AS active,
         COUNT(*) FILTER (WHERE archived_at IS NOT NULL)::text AS archived,
         COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '7 days')::text AS updated_7d,
         COALESCE((
           SELECT COUNT(*)::text FROM chat_messages cm
           INNER JOIN chat_sessions cs ON cs.id = cm.session_id
           WHERE cs.user_id = $1::uuid
         ), '0') AS messages_total
       FROM chat_sessions
       WHERE user_id = $1::uuid`,
      [userId],
    )
    const r = res.rows[0]
    return {
      total: Number(r?.total || 0),
      active: Number(r?.active || 0),
      archived: Number(r?.archived || 0),
      updatedLast7Days: Number(r?.updated_7d || 0),
      messagesTotal: Number(r?.messages_total || 0),
    }
  }

  async listSessions(userId: string, filters: HistoryListFilter) {
    const q = (filters.q || '').trim() || null
    const days =
      filters.days != null && Number(filters.days) > 0 ? Math.min(365, Number(filters.days)) : null
    const scope = normalizeScope(filters.scope)
    const page = Math.max(1, Number(filters.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(filters.limit) || 20))
    const offset = (page - 1) * limit

    const rows = await this.db.query<{
      id: string
      title: string
      created_at: string
      updated_at: string
      archived_at: string | null
      message_count: string
      preview: string | null
    }>(
      `SELECT
         cs.id,
         cs.title,
         cs.created_at,
         cs.updated_at,
         cs.archived_at,
         (SELECT COUNT(*)::text FROM chat_messages cm WHERE cm.session_id = cs.id) AS message_count,
         (
           SELECT substring(cm.content FROM 1 FOR 200)
           FROM chat_messages cm
           WHERE cm.session_id = cs.id
           ORDER BY cm.created_at DESC
           LIMIT 1
         ) AS preview
       FROM chat_sessions cs
       WHERE cs.user_id = $1::uuid
         AND ($2::text IS NULL OR cs.title ILIKE '%' || $2 || '%')
         AND ($3::int IS NULL OR cs.updated_at >= NOW() - ($3::int * INTERVAL '1 day'))
         AND (
           $4::text = 'all' OR
           ($4::text = 'active' AND cs.archived_at IS NULL) OR
           ($4::text = 'archived' AND cs.archived_at IS NOT NULL)
         )
       ORDER BY cs.updated_at DESC
       LIMIT $5 OFFSET $6`,
      [userId, q, days, scope, limit, offset],
    )

    const countRes = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM chat_sessions cs
       WHERE cs.user_id = $1::uuid
         AND ($2::text IS NULL OR cs.title ILIKE '%' || $2 || '%')
         AND ($3::int IS NULL OR cs.updated_at >= NOW() - ($3::int * INTERVAL '1 day'))
         AND (
           $4::text = 'all' OR
           ($4::text = 'active' AND cs.archived_at IS NULL) OR
           ($4::text = 'archived' AND cs.archived_at IS NOT NULL)
         )`,
      [userId, q, days, scope],
    )
    const total = Number(countRes.rows[0]?.c || 0)

    const items = rows.rows.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      archived: s.archived_at != null,
      archivedAt: s.archived_at,
      messageCount: Number(s.message_count || 0),
      preview: (s.preview || '').replace(/\s+/g, ' ').trim() || '（暂无消息）',
      status: s.archived_at ? 'archived' : 'active',
      category: '智能对话',
    }))

    return {
      items,
      page,
      limit,
      total,
      hasMore: offset + items.length < total,
    }
  }

  async archiveSession(userId: string, sessionId: string) {
    const res = await this.db.query<{ id: string }>(
      `UPDATE chat_sessions
       SET archived_at = COALESCE(archived_at, NOW()), updated_at = NOW()
       WHERE id = $1::uuid AND user_id = $2::uuid AND archived_at IS NULL
       RETURNING id`,
      [sessionId, userId],
    )
    if (res.rows.length === 0) {
      const exists = await this.db.query(`SELECT archived_at FROM chat_sessions WHERE id = $1::uuid AND user_id = $2::uuid`, [
        sessionId,
        userId,
      ])
      if (exists.rows.length === 0) throw new NotFoundException('会话不存在')
      return { ok: true, id: sessionId, alreadyArchived: true }
    }
    return { ok: true, id: res.rows[0].id }
  }

  async unarchiveSession(userId: string, sessionId: string) {
    const res = await this.db.query<{ id: string }>(
      `UPDATE chat_sessions
       SET archived_at = NULL, updated_at = NOW()
       WHERE id = $1::uuid AND user_id = $2::uuid AND archived_at IS NOT NULL
       RETURNING id`,
      [sessionId, userId],
    )
    if (res.rows.length === 0) {
      const exists = await this.db.query(`SELECT 1 FROM chat_sessions WHERE id = $1::uuid AND user_id = $2::uuid`, [
        sessionId,
        userId,
      ])
      if (exists.rows.length === 0) throw new NotFoundException('会话不存在')
      return { ok: true, id: sessionId, wasNotArchived: true }
    }
    return { ok: true, id: res.rows[0].id }
  }

  async bulkArchive(userId: string, ids: string[]) {
    const list = parseUuidList(ids)
    const res = await this.db.query(
      `UPDATE chat_sessions
       SET archived_at = COALESCE(archived_at, NOW()), updated_at = NOW()
       WHERE user_id = $1::uuid AND id = ANY($2::uuid[]) AND archived_at IS NULL`,
      [userId, list],
    )
    return { ok: true, affected: res.rowCount ?? 0 }
  }

  async bulkUnarchive(userId: string, ids: string[]) {
    const list = parseUuidList(ids)
    const res = await this.db.query(
      `UPDATE chat_sessions
       SET archived_at = NULL, updated_at = NOW()
       WHERE user_id = $1::uuid AND id = ANY($2::uuid[]) AND archived_at IS NOT NULL`,
      [userId, list],
    )
    return { ok: true, affected: res.rowCount ?? 0 }
  }

  async bulkDelete(userId: string, ids: string[]) {
    const list = parseUuidList(ids)
    const res = await this.db.query(
      `DELETE FROM chat_sessions WHERE user_id = $1::uuid AND id = ANY($2::uuid[])`,
      [userId, list],
    )
    return { ok: true, affected: res.rowCount ?? 0 }
  }
}
