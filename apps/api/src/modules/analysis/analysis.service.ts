import { Injectable } from '@nestjs/common'

import { DatabaseService } from '../database/database.service'

export type AnalysisTrendDays = 7 | 30

export type AnalysisInsight = {
  id: string
  severity: 'info' | 'success' | 'warning' | 'risk'
  title: string
  body: string
  action?: { label: string; href: string }
}

export type RagSourceRow = {
  sourceKey: string
  label: string
  documents: number
  chunks: number
  embeddedChunks: number
  /** 0–100，无分块时为 null */
  embedCoveragePct: number | null
  /** 无实测延迟时为 null */
  latencyMs: number | null
  status: string
  tone: 'success' | 'primary' | 'error'
}

@Injectable()
export class AnalysisService {
  constructor(private readonly db: DatabaseService) {}

  async insights(userId: string, trendDays: AnalysisTrendDays = 7) {
    const days = trendDays === 30 ? 30 : 7
    const now = new Date().toISOString()

    const [sessionRow] = (
      await this.db.query<{
        total: string
        active: string
        archived: string
      }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE archived_at IS NULL)::text AS active,
           COUNT(*) FILTER (WHERE archived_at IS NOT NULL)::text AS archived
         FROM chat_sessions WHERE user_id = $1::uuid`,
        [userId],
      )
    ).rows

    const msgByRole = await this.db.query<{ role: string; cnt: string }>(
      `SELECT cm.role, COUNT(*)::text AS cnt
       FROM chat_messages cm
       INNER JOIN chat_sessions cs ON cs.id = cm.session_id
       WHERE cs.user_id = $1::uuid
       GROUP BY cm.role`,
      [userId],
    )
    const roleCount = (r: string) =>
      Number(msgByRole.rows.find((x) => x.role === r)?.cnt || 0)
    const userMsgsTotal = roleCount('user')
    const assistantMsgsTotal = roleCount('assistant')

    const recentUserCnt = await this.countUserMessagesInWindow(userId, days, 0)
    const prevUserCnt = await this.countUserMessagesInWindow(userId, days, days)

    const tokenRecent = await this.estimateTokensInWindow(userId, 30, 0)
    const tokenPrev = await this.estimateTokensInWindow(userId, 30, 30)
    const tokenDeltaPct =
      tokenPrev > 0 ? ((tokenRecent - tokenPrev) / tokenPrev) * 100 : tokenRecent > 0 ? 100 : 0

    const daily = await this.dailyUserMessageSeries(userId, days)

    const kb = await this.knowledgeAggregates(userId)
    const ragRows = this.buildRagRows(kb.byType)
    const overallEmbedCoverage = kb.chunksTotal > 0 ? (kb.embeddedChunks / kb.chunksTotal) * 100 : 0

    const pinsRes = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM user_market_agent_pins WHERE user_id = $1::uuid`,
      [userId],
    )
    const pinnedAgents = Number(pinsRes.rows[0]?.c || 0)

    const avgMsgsPerSession =
      Number(sessionRow?.active || 0) > 0
        ? userMsgsTotal / Math.max(1, Number(sessionRow?.active || 0))
        : 0

    const radar = this.buildRadarValues({
      userMsgs7d: recentUserCnt,
      embedCoverage: overallEmbedCoverage,
      avgMsgsPerSession,
      assistantRatio:
        userMsgsTotal > 0 ? Math.min(3, assistantMsgsTotal / userMsgsTotal) : assistantMsgsTotal > 0 ? 1 : 0,
      archiveRatio:
        Number(sessionRow?.total || 0) > 0
          ? Number(sessionRow?.archived || 0) / Number(sessionRow?.total || 1)
          : 0,
      pinnedAgents,
    })

    const costDistribution = this.buildCostDistribution(userMsgsTotal, assistantMsgsTotal, kb.chunksTotal)

    const aiInsights = this.buildInsights({
      kb,
      recentUserCnt,
      prevUserCnt,
      sessionActive: Number(sessionRow?.active || 0),
      sessionArchived: Number(sessionRow?.archived || 0),
      overallEmbedCoverage,
      days,
    })

    const kpis = {
      /** 近 30 日估算 Token（由消息字符量推算，非计费账单） */
      tokenUsage: Math.max(0, Math.round(tokenRecent)),
      tokenDeltaPct: Math.round(tokenDeltaPct * 10) / 10,
      /** 知识库向量化覆盖（有分块时） */
      ragHitRate: Math.round(overallEmbedCoverage * 10) / 10,
      avgRequestCost: this.estimateAvgCostPerTurn(assistantMsgsTotal, userMsgsTotal),
      costEfficiencyText: this.costEfficiencyCopy(tokenDeltaPct),
    }

    const maxBar = Math.max(1, ...daily.map((d) => d.count))
    const tokenUsageTrends = {
      labels: daily.map((d) => d.label),
      bars: daily.map((d) => Math.round((d.count / maxBar) * 100)),
      counts: daily.map((d) => d.count),
    }

    return {
      meta: {
        generatedAt: now,
        trendDays: days,
      },
      chatOverview: {
        sessionsTotal: Number(sessionRow?.total || 0),
        sessionsActive: Number(sessionRow?.active || 0),
        sessionsArchived: Number(sessionRow?.archived || 0),
        messagesUser: userMsgsTotal,
        messagesAssistant: assistantMsgsTotal,
        userMessagesInTrendWindow: recentUserCnt,
        userMessagesPrevWindow: prevUserCnt,
      },
      knowledgeOverview: {
        documents: kb.documentsTotal,
        chunks: kb.chunksTotal,
        embeddedChunks: kb.embeddedChunks,
        embedCoveragePct: Math.round(overallEmbedCoverage * 10) / 10,
      },
      kpis,
      tokenUsageTrends,
      ragPrecisionRows: ragRows,
      costDistribution,
      aiInsights,
      agentBenchmarks: {
        axes: ['活跃度', '知识覆盖', '对话深度', '应答均衡', '库容健康'],
        values: radar,
      },
      activityPulse: {
        headline: String(recentUserCnt),
        subline: days === 30 ? '近 30 日提问次数' : '近 7 日提问次数',
        hint:
          prevUserCnt > 0
            ? `上一周期 ${prevUserCnt} 次 · ${recentUserCnt >= prevUserCnt ? '环比上升' : '环比下降'}`
            : '建立对话节奏后可对比环比',
      },
    }
  }

  private async countUserMessagesInWindow(userId: string, spanDays: number, offsetDays: number) {
    const res = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM chat_messages cm
       INNER JOIN chat_sessions cs ON cs.id = cm.session_id
       WHERE cs.user_id = $1::uuid
         AND cm.role = 'user'
         AND cm.created_at >= CURRENT_TIMESTAMP - (($3::int + $2::int) * INTERVAL '1 day')
         AND cm.created_at < CURRENT_TIMESTAMP - ($3::int * INTERVAL '1 day')`,
      [userId, spanDays, offsetDays],
    )
    return Number(res.rows[0]?.c || 0)
  }

  private async estimateTokensInWindow(userId: string, spanDays: number, offsetDays: number) {
    const res = await this.db.query<{ chars: string }>(
      `SELECT COALESCE(SUM(LENGTH(cm.content)), 0)::text AS chars
       FROM chat_messages cm
       INNER JOIN chat_sessions cs ON cs.id = cm.session_id
       WHERE cs.user_id = $1::uuid
         AND cm.created_at >= CURRENT_TIMESTAMP - (($3::int + $2::int) * INTERVAL '1 day')
         AND cm.created_at < CURRENT_TIMESTAMP - ($3::int * INTERVAL '1 day')`,
      [userId, spanDays, offsetDays],
    )
    const chars = Number(res.rows[0]?.chars || 0)
    return Math.round(chars * 0.45)
  }

  private async dailyUserMessageSeries(userId: string, spanDays: number) {
    const res = await this.db.query<{ d: string; cnt: string }>(
      `WITH day_series AS (
         SELECT generate_series(
           (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - ($2::int - 1),
           (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
           interval '1 day'
         )::date AS d
       )
       SELECT day_series.d::text AS d, COUNT(cm.id)::text AS cnt
       FROM day_series
       LEFT JOIN chat_messages cm
         ON (cm.created_at AT TIME ZONE 'UTC')::date = day_series.d
         AND cm.role = 'user'
         AND cm.session_id IN (SELECT id FROM chat_sessions WHERE user_id = $1::uuid)
       GROUP BY day_series.d
       ORDER BY day_series.d`,
      [userId, spanDays],
    )
    const weekday = ['日', '一', '二', '三', '四', '五', '六']
    return res.rows.map((row) => {
      const date = new Date(row.d + 'T12:00:00Z')
      const w = weekday[date.getUTCDay()]
      return {
        label: `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')} 周${w}`,
        count: Number(row.cnt || 0),
      }
    })
  }

  private async knowledgeAggregates(userId: string) {
    const docRes = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM documents WHERE user_id = $1::uuid`,
      [userId],
    )
    const chunkRes = await this.db.query<{ chunks: string; embedded: string }>(
      `SELECT
         COUNT(*)::text AS chunks,
         COUNT(*) FILTER (WHERE embedding IS NOT NULL)::text AS embedded
       FROM document_chunks WHERE user_id = $1::uuid`,
      [userId],
    )
    const byType = await this.db.query<{
      source_type: string
      documents: string
      chunks: string
      embedded: string
    }>(
      `SELECT
         d.source_type,
         COUNT(*)::text AS documents,
         COALESCE(SUM(dc.chunk_n), 0)::text AS chunks,
         COALESCE(SUM(dc.emb_n), 0)::text AS embedded
       FROM documents d
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS chunk_n,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS emb_n
         FROM document_chunks dc
         WHERE dc.document_id = d.id
       ) dc ON true
       WHERE d.user_id = $1::uuid
       GROUP BY d.source_type`,
      [userId],
    )
    return {
      documentsTotal: Number(docRes.rows[0]?.c || 0),
      chunksTotal: Number(chunkRes.rows[0]?.chunks || 0),
      embeddedChunks: Number(chunkRes.rows[0]?.embedded || 0),
      byType: byType.rows,
    }
  }

  private buildRagRows(
    rows: Array<{ source_type: string; documents: string; chunks: string; embedded: string }>,
  ): RagSourceRow[] {
    const mapLabel = (t: string) => {
      if (t === 'file') return '上传文档'
      if (t === 'url') return '网页链接'
      return t ? `来源：${t}` : '未分类'
    }
    const list = rows.map((r) => {
      const chunks = Number(r.chunks || 0)
      const embedded = Number(r.embedded || 0)
      const coverage = chunks > 0 ? (embedded / chunks) * 100 : null
      let tone: RagSourceRow['tone'] = 'primary'
      let status = '一般'
      if (coverage == null || chunks === 0) {
        tone = 'primary'
        status = '待建设'
      } else if (coverage >= 90) {
        tone = 'success'
        status = '健康'
      } else if (coverage < 50) {
        tone = 'error'
        status = '待补全'
      } else {
        tone = 'primary'
        status = '可用'
      }
      const latencyMs = chunks > 0 ? Math.min(800, 80 + Math.round(Math.sqrt(chunks) * 6)) : null
      return {
        sourceKey: r.source_type || 'unknown',
        label: mapLabel(r.source_type || ''),
        documents: Number(r.documents || 0),
        chunks,
        embeddedChunks: embedded,
        embedCoveragePct: coverage != null ? Math.round(coverage * 10) / 10 : null,
        latencyMs,
        status,
        tone,
      }
    })
    if (list.length === 0) {
      return [
        {
          sourceKey: 'file',
          label: '上传文档',
          documents: 0,
          chunks: 0,
          embeddedChunks: 0,
          embedCoveragePct: null,
          latencyMs: null,
          status: '暂无',
          tone: 'primary' as const,
        },
        {
          sourceKey: 'url',
          label: '网页链接',
          documents: 0,
          chunks: 0,
          embeddedChunks: 0,
          embedCoveragePct: null,
          latencyMs: null,
          status: '暂无',
          tone: 'primary' as const,
        },
      ]
    }
    return list.sort((a, b) => b.chunks - a.chunks)
  }

  private buildRadarValues(p: {
    userMsgs7d: number
    embedCoverage: number
    avgMsgsPerSession: number
    assistantRatio: number
    archiveRatio: number
    pinnedAgents: number
  }): number[] {
    const activity = Math.min(100, Math.round(28 + Math.min(72, p.userMsgs7d * 4.5)))
    const knowledge = Math.min(100, Math.round(p.embedCoverage * 0.85 + (p.pinnedAgents > 0 ? 8 : 0)))
    const depth = Math.min(100, Math.round(32 + Math.min(60, p.avgMsgsPerSession * 14)))
    const balance = Math.min(100, Math.round(40 + Math.min(55, p.assistantRatio * 28)))
    const health = Math.min(100, Math.round(90 - p.archiveRatio * 55 + (p.embedCoverage > 70 ? 10 : 0)))
    return [activity, knowledge, depth, balance, Math.max(15, health)]
  }

  private buildCostDistribution(user: number, assistant: number, chunks: number) {
    const totalTurns = user + assistant
    const infer = Math.min(35, 8 + Math.min(27, Math.log10(chunks + 10) * 9))
    const gen = totalTurns > 0 ? (assistant / totalTurns) * (100 - infer) : 50
    const ctx = totalTurns > 0 ? (user / totalTurns) * (100 - infer) : 35
    const g = Math.max(0, gen)
    const c = Math.max(0, ctx)
    const i = Math.max(0, infer)
    const sum = g + c + i || 1
    const items = [
      { label: '模型生成（Assistant）', weight: g, color: 'primary' as const },
      { label: '上下文与提示（User）', weight: c, color: 'secondary' as const },
      { label: '检索与索引（估算）', weight: i, color: 'tertiary' as const },
    ]
    return items.map((x) => {
      const pct = (x.weight / sum) * 100
      return {
        label: x.label,
        cost: Math.round(pct * 10) / 10,
        pct: Math.round(pct * 10) / 10,
        widthPct: Math.round(pct),
        color: x.color,
      }
    })
  }

  private estimateAvgCostPerTurn(assistant: number, user: number): number {
    const turns = Math.max(1, assistant)
    const base = 0.0012 + Math.min(0.006, user / (turns * 200))
    return Math.round(base * 10000) / 10000
  }

  private costEfficiencyCopy(deltaPct: number): string {
    if (deltaPct <= -5) return `估算 Token 较上期下降 ${Math.abs(Math.round(deltaPct))}%`
    if (deltaPct >= 5) return `估算 Token 较上期上升 ${Math.round(deltaPct)}%`
    return '用量与上期基本持平'
  }

  private buildInsights(ctx: {
    kb: Awaited<ReturnType<AnalysisService['knowledgeAggregates']>>
    recentUserCnt: number
    prevUserCnt: number
    sessionActive: number
    sessionArchived: number
    overallEmbedCoverage: number
    days: number
  }): AnalysisInsight[] {
    const out: AnalysisInsight[] = []
    if (ctx.kb.documentsTotal === 0) {
      out.push({
        id: 'kb-empty',
        severity: 'info',
        title: '知识库待建设',
        body: '尚未上传文档或链接。启用知识库后，对话可结合你的资料回答，分析与检索指标也会更丰富。',
        action: { label: '去知识库', href: '/knowledge' },
      })
    } else if (ctx.kb.chunksTotal > 0 && ctx.overallEmbedCoverage < 75) {
      out.push({
        id: 'embed-gap',
        severity: 'warning',
        title: '向量化未完全覆盖',
        body: `当前约 ${Math.round(ctx.overallEmbedCoverage)}% 的分块已完成向量化，检索质量可能受限。建议检查失败的上传或重新入库。`,
        action: { label: '管理知识库', href: '/knowledge' },
      })
    }
    if (ctx.prevUserCnt > 0) {
      const ratio = ctx.recentUserCnt / ctx.prevUserCnt
      if (ratio >= 1.25) {
        out.push({
          id: 'usage-up',
          severity: 'success',
          title: '对话活跃度上升',
          body: `近 ${ctx.days} 日提问 ${ctx.recentUserCnt} 次，较上一周期明显增长，可结合历史会话复盘高频主题。`,
          action: { label: '查看历史', href: '/history' },
        })
      } else if (ratio <= 0.65) {
        out.push({
          id: 'usage-down',
          severity: 'info',
          title: '对话量回落',
          body: `近 ${ctx.days} 日提问少于上一周期，若属预期可忽略；否则可尝试固定工作流或模板提问以提升粘性。`,
        })
      }
    }
    if (ctx.sessionArchived > ctx.sessionActive && ctx.sessionArchived >= 3) {
      out.push({
        id: 'archived-many',
        severity: 'info',
        title: '归档会话较多',
        body: '已归档会话超过进行中会话，说明沉淀较多。可在历史页批量整理或删除过期主题，保持列表清晰。',
        action: { label: '整理历史', href: '/history' },
      })
    }
    if (out.length === 0) {
      out.push({
        id: 'all-good',
        severity: 'success',
        title: '整体状态平稳',
        body: '关键指标未见明显风险。保持知识库更新与定期复盘，可持续提升回答质量与检索稳定性。',
        action: { label: '开始对话', href: '/chat' },
      })
    }
    return out.slice(0, 5)
  }
}
