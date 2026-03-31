<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useSubNav } from '../composables/useSubNav'
import { apiFetch } from '../lib/apiClient'
import { useAuth } from '../composables/useAuth'

const { subNavClass } = useSubNav()
const { loginIfNeeded } = useAuth()

type RagRow = {
  sourceKey: string
  label: string
  documents: number
  chunks: number
  embeddedChunks: number
  embedCoveragePct: number | null
  latencyMs: number | null
  status: string
  tone: 'success' | 'primary' | 'error'
}

type CostItem = {
  label: string
  cost: number
  pct: number
  widthPct: number
  color: 'primary' | 'secondary' | 'tertiary'
}

type AnalysisInsight = {
  id: string
  severity: 'info' | 'success' | 'warning' | 'risk'
  title: string
  body: string
  action?: { label: string; href: string }
}

type AnalysisPayload = {
  meta: { generatedAt: string; trendDays: number }
  chatOverview: {
    sessionsTotal: number
    sessionsActive: number
    sessionsArchived: number
    messagesUser: number
    messagesAssistant: number
    userMessagesInTrendWindow: number
    userMessagesPrevWindow: number
  }
  knowledgeOverview: {
    documents: number
    chunks: number
    embeddedChunks: number
    embedCoveragePct: number
  }
  kpis: {
    tokenUsage: number
    tokenDeltaPct: number
    ragHitRate: number
    avgRequestCost: number
    costEfficiencyText: string
  }
  tokenUsageTrends: {
    labels?: string[]
    bars?: number[]
    counts?: number[]
  }
  ragPrecisionRows: RagRow[]
  costDistribution: CostItem[]
  aiInsights: AnalysisInsight[]
  agentBenchmarks?: {
    axes?: string[]
    values?: number[]
  }
  activityPulse: {
    headline: string
    subline: string
    hint: string
  }
}

const loading = ref(true)
const loadError = ref<string | null>(null)
const trendDays = ref<7 | 30>(7)
const metricSearch = ref('')

const payload = ref<AnalysisPayload | null>(null)

const kpis = computed(() => payload.value?.kpis)
/** 与旧版 API 或缺字段响应兼容，保证 bars / labels / counts 等长 */
const tokenUsageTrends = computed(() => {
  const raw = payload.value?.tokenUsageTrends
  if (!raw) return null
  const bars = Array.isArray(raw.bars) ? raw.bars : []
  const n = bars.length
  if (n === 0) return { bars: [], labels: [] as string[], counts: [] as number[] }
  return {
    bars,
    labels: Array.from({ length: n }, (_, i) => raw.labels?.[i] ?? `D${i + 1}`),
    counts: Array.from({ length: n }, (_, i) => Number(raw.counts?.[i] ?? 0)),
  }
})
const ragPrecisionRows = computed(() => payload.value?.ragPrecisionRows ?? [])
const costDistribution = computed(() => payload.value?.costDistribution ?? [])
const aiInsights = computed(() => payload.value?.aiInsights ?? [])
/** 雷达图：兼容缺省 axes / values 的旧响应 */
const radarBenchmarks = computed(() => {
  const a = payload.value?.agentBenchmarks
  if (!a) return null
  const values = Array.isArray(a.values) ? a.values : []
  if (values.length === 0) return null
  const n = values.length
  const axesIn = Array.isArray(a.axes) ? a.axes : []
  return {
    values,
    axes: Array.from({ length: n }, (_, i) => axesIn[i] ?? `维${i + 1}`),
  }
})
const activityPulse = computed(() => payload.value?.activityPulse)
const chatOverview = computed(() => payload.value?.chatOverview)
const knowledgeOverview = computed(() => payload.value?.knowledgeOverview)
const meta = computed(() => payload.value?.meta)

const q = computed(() => metricSearch.value.trim().toLowerCase())

const filteredRagRows = computed(() => {
  if (!q.value) return ragPrecisionRows.value
  return ragPrecisionRows.value.filter((r) => r.label.toLowerCase().includes(q.value))
})

const filteredInsights = computed(() => {
  if (!q.value) return aiInsights.value
  return aiInsights.value.filter(
    (i) => i.title.toLowerCase().includes(q.value) || i.body.toLowerCase().includes(q.value),
  )
})

function toneClass(tone: 'success' | 'primary' | 'error') {
  if (tone === 'success') return 'bg-green-100 text-green-700'
  if (tone === 'error') return 'bg-error/15 text-error'
  return 'bg-secondary-container text-secondary'
}

function severityBorder(sev: AnalysisInsight['severity']) {
  if (sev === 'success') return 'border-l-2 border-primary'
  if (sev === 'warning') return 'border-l-2 border-tertiary'
  if (sev === 'risk') return 'border-l-2 border-error'
  return 'border-l-2 border-secondary'
}

function costBarClass(color: 'primary' | 'secondary' | 'tertiary') {
  if (color === 'secondary') return 'bg-secondary'
  if (color === 'tertiary') return 'bg-tertiary'
  return 'bg-primary'
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1_000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function radarPolygonPoints(values: number[], radius = 36, cx = 50, cy = 50): string {
  const n = Math.max(3, values.length)
  return values
    .slice(0, n)
    .map((raw, i) => {
      const v = Math.min(100, Math.max(0, raw))
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
      const r = (v / 100) * radius
      const x = cx + r * Math.cos(angle)
      const y = cy + r * Math.sin(angle)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

function radarAxisLabelPos(index: number, n: number, radius = 44, cx = 50, cy = 50) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / n
  const x = cx + radius * Math.cos(angle)
  const y = cy + radius * Math.sin(angle)
  return { x, y, angle }
}

async function loadAnalysis() {
  loading.value = true
  loadError.value = null
  try {
    const d = trendDays.value
    payload.value = await apiFetch<AnalysisPayload>(`/analysis?trendDays=${d}`, { method: 'GET' })
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : String(e)
    payload.value = null
  } finally {
    loading.value = false
  }
}

watch(trendDays, () => {
  void loadAnalysis()
})

onMounted(async () => {
  const token = await loginIfNeeded()
  if (!token) {
    loading.value = false
    return
  }
  await loadAnalysis()
})
</script>

<template>
  <main data-page-route="/analysis" class="min-h-screen bg-background text-on-background">
    <header
      class="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-50 flex w-full items-center justify-between border-b-4 border-black bg-background px-4 py-3 shadow-xl sm:px-6 sm:py-4 lg:top-0 lg:px-8"
    >
      <div class="flex items-center gap-8 min-w-0" data-section-path="analysis.header-nav">
        <h1 class="shrink-0 text-lg font-black tracking-tighter text-primary font-headline sm:text-xl">分析与洞察</h1>
        <nav class="hidden md:flex gap-6 shrink-0" aria-label="本页子模块">
          <RouterLink
            :to="{ path: '/analysis', hash: '#analysis-monitor' }"
            :class="subNavClass('#analysis-monitor', true)"
            >实时监控</RouterLink
          >
          <RouterLink
            :to="{ path: '/analysis', hash: '#analysis-retrieval' }"
            :class="subNavClass('#analysis-retrieval')"
            >检索与健康度</RouterLink
          >
        </nav>
      </div>
      <div class="flex items-center gap-2 sm:gap-4 min-w-0">
        <div
          class="nb-input flex min-w-0 max-w-[min(100vw-5rem,14rem)] items-center gap-2 px-2 py-2 sm:max-w-xs sm:px-4"
        >
          <span class="material-symbols-outlined text-on-surface-variant text-sm shrink-0">search</span>
          <input
            v-model="metricSearch"
            class="bg-transparent border-none focus:ring-0 text-sm min-w-0 flex-1"
            placeholder="筛选指标与洞察…"
            type="search"
            autocomplete="off"
          />
        </div>
        <button
          type="button"
          class="nb-btn nb-btn-neutral p-2 rounded-full hover:bg-primary hover:text-on-primary transition-all shrink-0"
          title="重新拉取"
          :disabled="loading"
          @click="loadAnalysis"
        >
          <span class="material-symbols-outlined text-lg" :class="loading ? 'animate-spin' : ''">refresh</span>
        </button>
      </div>
    </header>

    <div class="mx-auto max-w-[1600px] space-y-6 p-4 sm:space-y-8 sm:p-6 lg:p-8">
      <div
        v-if="loadError"
        class="rounded-2xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error"
        role="alert"
      >
        {{ loadError }}
      </div>

      <div v-if="loading && !payload" class="rounded-2xl border-2 border-black bg-white p-8 text-center text-sm text-on-surface-variant shadow-[6px_6px_0_#141414]">
        正在加载分析数据…
      </div>

      <template v-else-if="payload && kpis">
        <p v-if="meta" class="text-xs text-on-surface-variant -mt-4">
          数据生成时间 {{ new Date(meta.generatedAt).toLocaleString() }} · 趋势窗口
          {{ meta.trendDays }} 天
        </p>

        <div id="analysis-monitor" class="scroll-mt-28 space-y-8">
          <div
            v-if="chatOverview && knowledgeOverview"
            class="flex flex-wrap gap-2 text-[11px] font-medium text-on-surface-variant"
          >
            <span class="nb-pill px-3 py-1 rounded-full bg-white"
              >进行中会话 {{ chatOverview.sessionsActive }}</span
            >
            <span class="nb-pill px-3 py-1 rounded-full bg-white"
              >已归档 {{ chatOverview.sessionsArchived }}</span
            >
            <span class="nb-pill px-3 py-1 rounded-full bg-white"
              >提问 {{ chatOverview.messagesUser }} · 回复 {{ chatOverview.messagesAssistant }}</span
            >
            <span class="nb-pill px-3 py-1 rounded-full bg-white"
              >知识文档 {{ knowledgeOverview.documents }} · 分块 {{ knowledgeOverview.chunks }}</span
            >
          </div>

          <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div
              class="md:col-span-2 bg-tertiary rounded-2xl p-8 flex flex-col justify-between relative overflow-hidden border-2 border-black shadow-[8px_8px_0_#141414]"
            >
              <div class="relative z-10">
                <p class="text-sm font-medium text-on-surface-variant mb-1">估算 Token（近 30 日）</p>
                <h3 class="text-4xl font-black font-headline text-primary">
                  {{ formatTokens(kpis.tokenUsage) }}
                  <span class="text-lg font-medium text-on-surface-variant/60">tokens</span>
                </h3>
                <div class="mt-4 flex items-center gap-2 flex-wrap">
                  <span
                    class="px-2 py-1 rounded-full text-[10px] font-bold"
                    :class="
                      kpis.tokenDeltaPct > 5
                        ? 'bg-tertiary-container text-tertiary'
                        : kpis.tokenDeltaPct < -5
                          ? 'bg-green-100 text-green-700'
                          : 'bg-surface-container-high text-on-surface-variant'
                    "
                    >{{ kpis.tokenDeltaPct >= 0 ? '+' : '' }}{{ kpis.tokenDeltaPct.toFixed(1) }}%</span
                  >
                  <span class="text-xs text-on-surface-variant">相对上一段 30 日窗口</span>
                </div>
              </div>
            </div>
            <div class="nb-card rounded-2xl p-6">
              <div class="flex items-center gap-3 mb-4">
                <div
                  class="w-8 h-8 rounded-lg bg-secondary-container/30 flex items-center justify-center text-secondary"
                >
                  <span class="material-symbols-outlined text-sm">layers</span>
                </div>
                <span class="text-sm font-medium">知识向量化覆盖</span>
              </div>
              <p class="text-3xl font-bold font-headline">{{ kpis.ragHitRate.toFixed(1) }}%</p>
              <p class="text-[10px] text-on-surface-variant mt-1">有分块时按已嵌入 / 总分块</p>
              <div class="w-full bg-surface-container-high h-1.5 rounded-full mt-4">
                <div class="bg-secondary h-1.5 rounded-full" :style="{ width: `${Math.min(100, kpis.ragHitRate)}%` }"></div>
              </div>
            </div>
            <div class="nb-card rounded-2xl p-6">
              <div class="flex items-center gap-3 mb-4">
                <div
                  class="w-8 h-8 rounded-lg bg-tertiary-container/30 flex items-center justify-center text-tertiary"
                >
                  <span class="material-symbols-outlined text-sm">payments</span>
                </div>
                <span class="text-sm font-medium">估算单次成本</span>
              </div>
              <p class="text-3xl font-bold font-headline">${{ kpis.avgRequestCost.toFixed(4) }}</p>
              <p class="text-xs text-on-surface-variant mt-4 flex items-center gap-1">
                <span class="material-symbols-outlined text-xs">insights</span>
                {{ kpis.costEfficiencyText }}
              </p>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div class="nb-card md:col-span-8 rounded-2xl p-6">
              <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
                <div>
                  <h4 class="text-lg font-bold font-headline">提问趋势</h4>
                  <p class="text-xs text-on-surface-variant">按日统计你的 user 消息条数</p>
                </div>
                <div class="flex gap-2 shrink-0">
                  <button
                    type="button"
                    class="nb-btn px-3 py-1.5 text-xs rounded-lg font-medium transition-colors"
                    :class="trendDays === 7 ? 'bg-primary text-on-primary border-2 border-black' : 'text-on-surface border-2 border-black bg-white hover:bg-primary hover:text-on-primary'"
                    @click="trendDays = 7"
                  >
                    7 天
                  </button>
                  <button
                    type="button"
                    class="nb-btn px-3 py-1.5 text-xs rounded-lg font-medium transition-colors"
                    :class="trendDays === 30 ? 'bg-secondary text-on-secondary border-2 border-black' : 'text-on-surface border-2 border-black bg-white hover:bg-secondary hover:text-on-secondary'"
                    @click="trendDays = 30"
                  >
                    30 天
                  </button>
                </div>
              </div>
              <div v-if="tokenUsageTrends" class="h-64 flex items-end gap-1.5 sm:gap-3 pb-4">
                <div
                  v-for="(bar, idx) in tokenUsageTrends.bars"
                  :key="`${idx}-${bar}`"
                  class="flex-1 flex flex-col justify-end items-center gap-2 min-w-0"
                >
                  <div
                    class="w-full transition-colors rounded-t-lg min-h-[4px]"
                    :class="idx === tokenUsageTrends.bars.length - 1 ? 'bg-primary' : 'bg-primary/25 hover:bg-primary/40'"
                    :style="{ height: `${Math.max(bar, 2)}%` }"
                    :title="`${tokenUsageTrends.counts[idx] ?? 0} 条`"
                  ></div>
                  <span class="text-[9px] sm:text-[10px] text-on-surface-variant text-center leading-tight truncate w-full">{{
                    tokenUsageTrends.labels[idx] || `D${idx + 1}`
                  }}</span>
                </div>
              </div>
            </div>

            <div class="nb-card md:col-span-4 bg-primary text-on-primary rounded-2xl p-6 overflow-hidden flex flex-col">
              <h4 class="text-lg font-bold font-headline mb-2">能力雷达</h4>
              <p class="text-[10px] text-on-primary/80 mb-4">由你的用量与知识库状态合成的参考画像（非模型评测）。</p>
              <div v-if="radarBenchmarks" class="flex-1 flex items-center justify-center relative min-h-[220px]">
                <svg class="w-full max-w-[220px] aspect-square relative z-10 overflow-visible" viewBox="0 0 100 100">
                  <polygon
                    fill="rgba(255, 255, 255, 0.08)"
                    stroke="rgba(255, 255, 255, 0.35)"
                    stroke-width="0.4"
                    :points="radarPolygonPoints(radarBenchmarks.values.map(() => 50))"
                  />
                  <polygon
                    fill="rgba(255, 255, 255, 0.25)"
                    stroke="rgba(255, 255, 255, 0.9)"
                    stroke-width="0.9"
                    :points="radarPolygonPoints(radarBenchmarks.values)"
                  />
                  <g v-for="(axis, i) in radarBenchmarks.axes" :key="`${axis}-${i}`">
                    <text
                      :x="radarAxisLabelPos(i, radarBenchmarks.axes.length).x"
                      :y="radarAxisLabelPos(i, radarBenchmarks.axes.length).y"
                      text-anchor="middle"
                      dominant-baseline="middle"
                    fill="#ffffff"
                    style="font-size: 5px"
                    >
                      {{ axis }}
                    </text>
                  </g>
                </svg>
              </div>
              <p v-else class="text-xs text-on-primary/80 text-center py-8">暂无雷达数据</p>
            </div>
          </div>
        </div>

        <div id="analysis-retrieval" class="scroll-mt-28 grid grid-cols-1 md:grid-cols-12 gap-6">
          <div class="nb-card md:col-span-8 rounded-2xl p-6 overflow-x-auto">
            <h4 class="text-lg font-bold font-headline mb-2">知识库来源健康度</h4>
            <p class="text-xs text-on-surface-variant mb-6">按文档来源类型汇总；延迟为基于分块规模的粗估。</p>
            <table class="w-full text-left text-sm min-w-[520px]">
              <thead>
                <tr class="text-on-surface-variant font-medium border-b border-outline-variant/10">
                  <th class="pb-3 px-2">数据源</th>
                  <th class="pb-3 px-2">文档</th>
                  <th class="pb-3 px-2">分块</th>
                  <th class="pb-3 px-2">向量化覆盖</th>
                  <th class="pb-3 px-2">估算延迟</th>
                  <th class="pb-3 px-2 text-right">状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in filteredRagRows" :key="row.sourceKey" class="border-b border-outline-variant/5">
                  <td class="py-4 px-2 font-medium">{{ row.label }}</td>
                  <td class="py-4 px-2">{{ row.documents }}</td>
                  <td class="py-4 px-2">{{ row.chunks }}</td>
                  <td class="py-4 px-2">
                    {{ row.embedCoveragePct != null ? `${row.embedCoveragePct.toFixed(1)}%` : '—' }}
                  </td>
                  <td class="py-4 px-2">{{ row.latencyMs != null ? `${row.latencyMs}ms` : '—' }}</td>
                  <td class="py-4 px-2 text-right">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold" :class="toneClass(row.tone)">
                      {{ row.status }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="filteredRagRows.length === 0" class="text-sm text-on-surface-variant py-6">没有匹配的条目</p>
          </div>

          <div class="md:col-span-4 flex flex-col gap-4">
            <div class="nb-card rounded-2xl p-5">
              <h4 class="text-sm font-bold font-headline mb-1">成本结构（估算）</h4>
              <p class="text-[10px] text-on-surface-variant mb-4">按对话轮次与知识库体量拆分权重，非账单。</p>
              <div class="space-y-3">
                <div v-for="item in costDistribution" :key="item.label" class="space-y-1">
                  <div class="flex items-center justify-between text-[10px] text-on-surface-variant gap-2">
                    <span class="truncate">{{ item.label }}</span
                    ><span class="shrink-0">{{ item.pct.toFixed(1) }}%</span>
                  </div>
                  <div class="h-1.5 bg-surface-container rounded-full overflow-hidden">
                    <div class="h-full" :class="costBarClass(item.color)" :style="{ width: `${item.widthPct}%` }"></div>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="activityPulse" class="nb-card rounded-2xl p-5 bg-secondary text-on-secondary">
              <p class="text-[10px] tracking-widest uppercase text-white/75 font-bold">活跃脉冲</p>
              <div class="mt-2 flex items-end justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-3xl font-black font-headline leading-none tabular-nums">{{ activityPulse.headline }}</p>
                  <p class="text-[11px] text-white/80 mt-1">{{ activityPulse.subline }}</p>
                  <p class="text-[10px] text-white/65 mt-2 leading-snug">{{ activityPulse.hint }}</p>
                </div>
                <span class="material-symbols-outlined text-3xl shrink-0">monitoring</span>
              </div>
            </div>
          </div>
        </div>

        <section class="space-y-4">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="text-lg font-bold font-headline">数据驱动洞察</h4>
            <span class="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">基于你的数据</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <article
              v-for="insight in filteredInsights"
              :key="insight.id"
              class="bg-white rounded-2xl p-5 shadow-[6px_6px_0_#141414] border-2 border-black"
              :class="severityBorder(insight.severity)"
            >
              <span class="text-[10px] font-bold tracking-widest text-outline uppercase">{{ insight.title }}</span>
              <p class="mt-3 text-sm text-on-surface-variant leading-relaxed">{{ insight.body }}</p>
              <RouterLink
                v-if="insight.action"
                :to="insight.action.href"
                class="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary"
              >
                {{ insight.action.label }} <span class="material-symbols-outlined text-sm">east</span>
              </RouterLink>
            </article>
          </div>
          <p v-if="filteredInsights.length === 0" class="text-sm text-on-surface-variant">没有匹配的洞察</p>
        </section>
      </template>
    </div>

    <button
      type="button"
      class="fixed bottom-8 right-8 w-12 h-12 rounded-full bg-primary text-on-primary shadow-lg shadow-primary/35 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform disabled:opacity-50"
      aria-label="刷新分析"
      :disabled="loading"
      @click="loadAnalysis"
    >
      <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1">bolt</span>
    </button>
  </main>
</template>
