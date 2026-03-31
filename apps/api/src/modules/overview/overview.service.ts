import { Injectable } from '@nestjs/common'

import { DatabaseService } from '../database/database.service'
import { MarketService } from '../market/market.service'

export type OverviewTrendWindow = '7d' | '30d'

type ActiveAgentCard = {
  id: string
  type: 'card' | 'deploy'
  name: string
  description: string
  status: string
  icon?: string
  iconBgClass?: string
  iconTextClass?: string
  statusPillClass?: string
  statusDotClass?: string
  linkTo?: string
  tags?: string[]
}

function pctDelta(curr: number, prev: number): number {
  if (prev <= 0) return curr > 0 ? 100 : 0
  return ((curr - prev) / prev) * 100
}

function truncateSnippet(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1)}…`
}

/** 粗略 token 估计：中英混排约 4 字符 ≈ 1 token */
function charsToEstimatedTokens(chars: number): number {
  return Math.max(0, Math.round(chars / 4))
}

/** 用助手消息平均长度推导「体感延迟」展示值（非真实 RTT，仅作趋势参考） */
function latencyFromAvgAssistantChars(avgChars: number | null): number | null {
  if (avgChars == null || Number.isNaN(avgChars)) return null
  return Math.round(Math.min(2400, Math.max(72, 68 + avgChars / 14)))
}

@Injectable()
export class OverviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly market: MarketService,
  ) {}

  async dashboard(userId: string, trendWindow: OverviewTrendWindow = '7d') {
    const now = Date.now()
    const since30d = new Date(now - 30 * 24 * 3600 * 1000)
    const since60d = new Date(now - 60 * 24 * 3600 * 1000)
    const sincePrev30End = since30d

    const [
      sessionsRow,
      docsRow,
      chunksRow,
      msg30,
      msgPrev30,
      userMsg30,
      userMsgPrev30,
      chars30,
      charsPrev30,
      avgAsst30,
      avgAsstPrev30,
      activityRows,
    ] = await Promise.all([
      this.db.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM chat_sessions WHERE user_id = $1`,
        [userId],
      ),
      this.db.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM documents WHERE user_id = $1`, [userId]),
      this.db.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM document_chunks WHERE user_id = $1`,
        [userId],
      ),
      this.db.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM chat_messages m
         INNER JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.user_id = $1 AND m.created_at >= $2`,
        [userId, since30d],
      ),
      this.db.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM chat_messages m
         INNER JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.user_id = $1 AND m.created_at >= $2 AND m.created_at < $3`,
        [userId, since60d, sincePrev30End],
      ),
      this.db.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM chat_messages m
         INNER JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.user_id = $1 AND m.role = 'user' AND m.created_at >= $2`,
        [userId, since30d],
      ),
      this.db.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM chat_messages m
         INNER JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.user_id = $1 AND m.role = 'user' AND m.created_at >= $2 AND m.created_at < $3`,
        [userId, since60d, sincePrev30End],
      ),
      this.db.query<{ c: string }>(
        `SELECT COALESCE(SUM(LENGTH(m.content)), 0)::text AS c
         FROM chat_messages m
         INNER JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.user_id = $1 AND m.created_at >= $2`,
        [userId, since30d],
      ),
      this.db.query<{ c: string }>(
        `SELECT COALESCE(SUM(LENGTH(m.content)), 0)::text AS c
         FROM chat_messages m
         INNER JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.user_id = $1 AND m.created_at >= $2 AND m.created_at < $3`,
        [userId, since60d, sincePrev30End],
      ),
      this.db.query<{ a: string | null }>(
        `SELECT AVG(LENGTH(m.content))::text AS a
         FROM chat_messages m
         INNER JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.user_id = $1 AND m.role = 'assistant' AND m.created_at >= $2`,
        [userId, since30d],
      ),
      this.db.query<{ a: string | null }>(
        `SELECT AVG(LENGTH(m.content))::text AS a
         FROM chat_messages m
         INNER JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.user_id = $1 AND m.role = 'assistant' AND m.created_at >= $2 AND m.created_at < $3`,
        [userId, since60d, sincePrev30End],
      ),
      this.db.query<{
        id: string
        session_id: string
        role: string
        content: string
        created_at: string
        title: string
      }>(
        `SELECT m.id, m.session_id, m.role, m.content, m.created_at::text, s.title
         FROM chat_messages m
         INNER JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.user_id = $1
         ORDER BY m.created_at DESC
         LIMIT 14`,
        [userId],
      ),
    ])

    const chatSessions = Number(sessionsRow.rows[0]?.c || 0)
    const documents = Number(docsRow.rows[0]?.c || 0)
    const chunks = Number(chunksRow.rows[0]?.c || 0)
    const messagesLast30d = Number(msg30.rows[0]?.c || 0)
    const messagesPrev30d = Number(msgPrev30.rows[0]?.c || 0)
    const userMessages30d = Number(userMsg30.rows[0]?.c || 0)
    const userMessagesPrev30d = Number(userMsgPrev30.rows[0]?.c || 0)
    const charsLast30d = Number(chars30.rows[0]?.c || 0)
    const charsPrev30d = Number(charsPrev30.rows[0]?.c || 0)

    const estTokens30d = charsToEstimatedTokens(charsLast30d)
    const estTokensPrev30d = charsToEstimatedTokens(charsPrev30d)

    const avgAsstCurr = avgAsst30.rows[0]?.a != null ? Number(avgAsst30.rows[0].a) : null
    const avgAsstPrev = avgAsstPrev30.rows[0]?.a != null ? Number(avgAsstPrev30.rows[0].a) : null
    const avgLatencyMs = latencyFromAvgAssistantChars(avgAsstCurr)
    const avgLatencyPrev = latencyFromAvgAssistantChars(avgAsstPrev)
    const latencyDeltaMs =
      avgLatencyMs != null && avgLatencyPrev != null ? avgLatencyMs - avgLatencyPrev : null

    const assistantLast30d = messagesLast30d - userMessages30d

    const taskTrend = await this.buildTaskTrend(userId, trendWindow)

    const activity = activityRows.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      sessionTitle: row.title || '未命名会话',
      role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      snippet: truncateSnippet(row.content || ''),
      occurredAt: row.created_at,
    }))

    const marketData = await this.market.getMarketPayload(userId, {})
    const hasRecentChat = userMessages30d > 0
    const activeAgents = this.buildAgentCards(marketData.catalog.slice(0, 3), hasRecentChat)

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        chatSessions,
        documents,
        chunks,
        userMessagesLast30d: userMessages30d,
        assistantMessagesLast30d: Math.max(0, assistantLast30d),
      },
      metrics: {
        tokenUsage: estTokens30d,
        tokenDeltaPct: pctDelta(estTokens30d, estTokensPrev30d),
        apiRequests: userMessages30d,
        apiDeltaPct: pctDelta(userMessages30d, userMessagesPrev30d),
        avgLatencyMs,
        latencyDeltaMs,
      },
      taskTrend,
      activity,
      activeAgents,
    }
  }

  private async buildTaskTrend(
    userId: string,
    window: OverviewTrendWindow,
  ): Promise<{ window: OverviewTrendWindow; labels: string[]; bars: number[]; counts: number[] }> {
    const days = window === '7d' ? 7 : 30

    const res = await this.db.query<{ d: string; c: string }>(
      `WITH days AS (
        SELECT generate_series(
          (CURRENT_DATE - (($2::int - 1) * INTERVAL '1 day'))::date,
          CURRENT_DATE::date,
          INTERVAL '1 day'
        )::date AS day
      )
      SELECT days.day::text AS d, COALESCE(t.cnt, 0)::text AS c
      FROM days
      LEFT JOIN (
        SELECT (m.created_at::date) AS d, COUNT(*)::int AS cnt
        FROM chat_messages m
        INNER JOIN chat_sessions s ON s.id = m.session_id
        WHERE s.user_id = $1 AND m.role = 'user'
        GROUP BY 1
      ) t ON t.d = days.day
      ORDER BY days.day`,
      [userId, days],
    )

    const dayKeys = res.rows.map((r) => r.d)
    const dailyCounts = res.rows.map((r) => Number(r.c))

    if (window === '7d') {
      const labels = dayKeys.map((k) => {
        const [, mo, da] = k.split('-')
        return `${Number(mo)}/${Number(da)}`
      })
      return this.normalizeTrend(window, labels, dailyCounts)
    }

    const bucketCount = 10
    const bucketSize = Math.ceil(days / bucketCount)
    const labels: string[] = []
    const counts: number[] = []
    for (let b = 0; b < bucketCount; b++) {
      const from = b * bucketSize
      const to = Math.min(days, (b + 1) * bucketSize)
      let sum = 0
      for (let i = from; i < to; i++) sum += dailyCounts[i] ?? 0
      counts.push(sum)
      const startKey = dayKeys[from]
      const endKey = dayKeys[to - 1]
      const fmt = (key: string) => {
        const [, mo, da] = key.split('-')
        return `${Number(mo)}/${Number(da)}`
      }
      labels.push(`${fmt(startKey)}–${fmt(endKey)}`)
    }
    return this.normalizeTrend(window, labels, counts)
  }

  private normalizeTrend(
    window: OverviewTrendWindow,
    labels: string[],
    counts: number[],
  ): { window: OverviewTrendWindow; labels: string[]; bars: number[]; counts: number[] } {
    const max = Math.max(1, ...counts)
    const bars = counts.map((c) => Math.max(8, Math.round((c / max) * 100)))
    return { window, labels, bars, counts }
  }

  private buildAgentCards(
    catalog: Array<{
      id: string
      name: string
      description: string
      category: string
      tags: string[]
    }>,
    hasRecentChat: boolean,
  ): ActiveAgentCard[] {
    const accents = [
      {
        icon: 'analytics',
        iconBgClass: 'bg-indigo-50',
        iconTextClass: 'text-primary',
      },
      {
        icon: 'trending_up',
        iconBgClass: 'bg-blue-50',
        iconTextClass: 'text-secondary',
      },
      {
        icon: 'dns',
        iconBgClass: 'bg-purple-50',
        iconTextClass: 'text-tertiary',
      },
    ] as const

    const running = {
      status: '运行中',
      statusPillClass: 'bg-emerald-50 text-emerald-600',
      statusDotClass: 'bg-emerald-500',
    }
    const idle = {
      status: '待命中',
      statusPillClass: 'bg-amber-50 text-amber-600',
      statusDotClass: 'bg-amber-500',
    }
    const pulse = hasRecentChat ? running : idle

    const cards: ActiveAgentCard[] = catalog.map((a, idx) => {
      const accent = accents[idx % accents.length]
      return {
        id: a.id,
        type: 'card',
        name: a.name,
        description: a.description,
        status: pulse.status,
        icon: accent.icon,
        iconBgClass: accent.iconBgClass,
        iconTextClass: accent.iconTextClass,
        statusPillClass: pulse.statusPillClass,
        statusDotClass: pulse.statusDotClass,
        linkTo: '/chat',
        tags: a.tags,
      }
    })

    cards.push({
      id: 'agent-deploy',
      type: 'deploy',
      name: '部署新智能体',
      description: '从市场选择模板，或自定义工作流与知识库联动。',
      status: '可用',
      linkTo: '/market',
    })

    return cards
  }
}
