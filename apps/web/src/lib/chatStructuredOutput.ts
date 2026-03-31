/**
 * 从助手回复中解析「分析看板」结构化数据（可选 JSON 代码块），与自然语言分离展示。
 * 约定：模型在回答末尾可输出 ```json ... ```，见后端系统提示 chat_insight_v1。
 */

import { stripAssistantLeakForDisplay } from './stripAssistantLeak'

export type TrendLabel = '上涨' | '下降' | '稳定'

export type KpiCard = {
  label: string
  value: string
  delta: string
  positive: boolean
}

export type SalesRow = {
  region: string
  amount: string
  ratio: string
  trend: TrendLabel
}

export type StructuredInsight = {
  schema?: string
  summary?: string
  kpis?: KpiCard[]
  salesRows?: SalesRow[]
  followUps?: string[]
}

function normalizeTrend(v: unknown): TrendLabel {
  const s = String(v ?? '').trim()
  if (s === '上涨' || s === '上升' || /up|rising/i.test(s)) return '上涨'
  if (s === '下降' || /down|fall/i.test(s)) return '下降'
  return '稳定'
}

function normalizeKpi(raw: unknown): KpiCard | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const label = String(o.label ?? '').trim()
  const value = String(o.value ?? '').trim()
  const delta = String(o.delta ?? '').trim()
  if (!label || !value) return null
  const positive =
    typeof o.positive === 'boolean'
      ? o.positive
      : !/^[-−]/.test(delta) && !/下降|减少|负/i.test(delta)
  return { label, value, delta: delta || '—', positive }
}

function normalizeRow(raw: unknown): SalesRow | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const region = String(o.region ?? o.name ?? '').trim()
  const amount = String(o.amount ?? o.sales ?? '').trim()
  const ratio = String(o.ratio ?? o.compare ?? '').trim()
  if (!region || !amount) return null
  return {
    region,
    amount,
    ratio: ratio || '—',
    trend: normalizeTrend(o.trend),
  }
}

function looksLikeInsight(obj: Record<string, unknown>): boolean {
  if (obj.schema === 'chat_insight_v1') return true
  if (Array.isArray(obj.kpis) && obj.kpis.length > 0) return true
  if (Array.isArray(obj.salesRows) && obj.salesRows.length > 0) return true
  return false
}

function normalizeInsight(raw: Record<string, unknown>): StructuredInsight {
  const kpis = Array.isArray(raw.kpis)
    ? (raw.kpis.map(normalizeKpi).filter(Boolean) as KpiCard[])
    : undefined
  const salesRows = Array.isArray(raw.salesRows)
    ? (raw.salesRows.map(normalizeRow).filter(Boolean) as SalesRow[])
    : undefined
  const followUps = Array.isArray(raw.followUps)
    ? raw.followUps.map((x) => String(x).trim()).filter(Boolean)
    : undefined
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : undefined
  return {
    schema: typeof raw.schema === 'string' ? raw.schema : undefined,
    summary: summary || undefined,
    kpis: kpis?.length ? kpis : undefined,
    salesRows: salesRows?.length ? salesRows : undefined,
    followUps: followUps?.length ? followUps : undefined,
  }
}

/**
 * 从原始助手文本中移除已识别的 insight JSON 代码块，返回清洗后的气泡文案 + 结构化数据（若有）。
 */
export function splitAssistantDisplayAndInsight(raw: string): {
  displayText: string
  insight: StructuredInsight | null
} {
  let insight: StructuredInsight | null = null
  let stripped = raw

  const re = /```(?:json)?\s*([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  const toRemove: string[] = []

  while ((m = re.exec(raw)) !== null) {
    const full = m[0]
    const inner = m[1]?.trim() ?? ''
    try {
      const parsed = JSON.parse(inner) as unknown
      if (parsed && typeof parsed === 'object' && looksLikeInsight(parsed as Record<string, unknown>)) {
        insight = normalizeInsight(parsed as Record<string, unknown>)
        toRemove.push(full)
      }
    } catch {
      // 非 JSON 或普通代码块，保留
    }
  }

  for (const block of toRemove) {
    stripped = stripped.split(block).join('\n')
  }
  stripped = stripped.replace(/\n{3,}/g, '\n\n').trim()

  return {
    displayText: stripAssistantLeakForDisplay(stripped),
    insight,
  }
}

export function assistantBubbleText(raw: string): string {
  return splitAssistantDisplayAndInsight(raw).displayText
}
