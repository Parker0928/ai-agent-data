<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useSubNav } from '../composables/useSubNav'
import { apiFetch } from '../lib/apiClient'
import { useAuth } from '../composables/useAuth'

const { subNavClass } = useSubNav()
const router = useRouter()

type TrendWindow = '7d' | '30d'

type OverviewPayload = {
  generatedAt: string
  summary: {
    chatSessions: number
    documents: number
    chunks: number
    userMessagesLast30d: number
    assistantMessagesLast30d: number
  }
  metrics: {
    tokenUsage: number
    tokenDeltaPct: number
    apiRequests: number
    apiDeltaPct: number
    avgLatencyMs: number | null
    latencyDeltaMs: number | null
  }
  taskTrend: {
    window: TrendWindow
    labels: string[]
    bars: number[]
    counts: number[]
  }
  activity: Array<{
    id: string
    sessionId: string
    sessionTitle: string
    role: 'user' | 'assistant'
    snippet: string
    occurredAt: string
  }>
  activeAgents: Array<{
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
  }>
}

const { loginIfNeeded, user, fetchMe } = useAuth()

const loading = ref(false)
const loadError = ref<string | null>(null)
const trendWindow = ref<TrendWindow>('7d')

const metrics = ref<OverviewPayload['metrics']>({
  tokenUsage: 0,
  tokenDeltaPct: 0,
  apiRequests: 0,
  apiDeltaPct: 0,
  avgLatencyMs: null,
  latencyDeltaMs: null,
})
const summary = ref<OverviewPayload['summary']>({
  chatSessions: 0,
  documents: 0,
  chunks: 0,
  userMessagesLast30d: 0,
  assistantMessagesLast30d: 0,
})
const taskTrend = ref<OverviewPayload['taskTrend']>({
  window: '7d',
  labels: [],
  bars: [],
  counts: [],
})
const activity = ref<OverviewPayload['activity']>([])
const activeAgents = ref<OverviewPayload['activeAgents']>([])
const searchQuery = ref('')

const greetingName = computed(() => {
  const email = user.value?.email
  if (!email) return '用户'
  const local = email.split('@')[0] || email
  return local.length > 24 ? `${local.slice(0, 24)}…` : local
})

const filteredActivity = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return activity.value
  return activity.value.filter(
    (a) =>
      a.sessionTitle.toLowerCase().includes(q) ||
      a.snippet.toLowerCase().includes(q) ||
      (a.role === 'user' ? '提问' : '回复').includes(q),
  )
})

const filteredAgents = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return activeAgents.value
  return activeAgents.value.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      (a.tags || []).some((t) => t.toLowerCase().includes(q)),
  )
})

const trendBars = computed(() => {
  const { labels, bars, counts } = taskTrend.value
  return labels.map((label, i) => ({
    label,
    heightPct: bars[i] ?? 12,
    count: counts[i] ?? 0,
  }))
})

const trendPeakIdx = computed(() => {
  const bars = trendBars.value
  if (!bars.length) return -1
  let best = 0
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].count > bars[best].count) best = i
  }
  return best
})

function fmtPct(p: number) {
  const sign = p >= 0 ? '+' : ''
  return `${sign}${p.toFixed(1)}%`
}

function formatApiRequests(n: number) {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k.toFixed(n >= 100000 ? 0 : 1)}k`
}

function formatLatency(ms: number | null) {
  if (ms == null) return '—'
  return `${ms}`
}

function activityDotClass(role: 'user' | 'assistant') {
  return role === 'user' ? 'bg-primary' : 'bg-secondary'
}

function activityBadge(role: 'user' | 'assistant') {
  return role === 'user' ? '用户提问' : '助手回复'
}

function timeAgoLabel(iso: string) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diffMin = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH} 小时前`
  const diffD = Math.round(diffH / 24)
  return `${diffD} 天前`
}

function tokenDeltaClass(p: number) {
  if (p > 0.5) return 'text-emerald-600 bg-emerald-50'
  if (p < -0.5) return 'text-error bg-error/5'
  return 'text-on-surface-variant bg-surface-container-low'
}

function apiDeltaClass(p: number) {
  return tokenDeltaClass(p)
}

function latencyDeltaClass(delta: number | null) {
  if (delta == null) return 'text-on-surface-variant bg-surface-container-low'
  if (delta <= -1) return 'text-emerald-600 bg-emerald-50'
  if (delta >= 1) return 'text-error bg-error/5'
  return 'text-on-surface-variant bg-surface-container-low'
}

async function loadDashboard() {
  loading.value = true
  loadError.value = null
  try {
    const token = await loginIfNeeded()
    if (!token) return
    await fetchMe()
    const q = trendWindow.value === '30d' ? '?trendWindow=30d' : ''
    const resp = await apiFetch<OverviewPayload>(`/overview${q}`, { method: 'GET' })
    metrics.value = resp.metrics
    summary.value = resp.summary
    taskTrend.value = resp.taskTrend
    activity.value = resp.activity || []
    activeAgents.value = resp.activeAgents || []
  } catch (e: any) {
    loadError.value = e?.message || '加载概览失败'
  } finally {
    loading.value = false
  }
}

function setTrendWindow(w: TrendWindow) {
  trendWindow.value = w
}

function goChatSession(sessionId: string) {
  router.push({ path: '/chat', query: { session: sessionId } })
}

onMounted(() => {
  void loadDashboard()
})

watch(trendWindow, () => {
  void loadDashboard()
})
</script>

<template>
  <main data-page-route="/overview" class="min-h-screen relative bg-background text-on-background">
    <header
      class="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-40 flex w-full items-center justify-between gap-3 border-b-4 border-black bg-background px-4 py-3 shadow-xl sm:gap-6 sm:px-6 sm:py-4 lg:top-0 lg:px-8"
    >
      <div class="flex items-center gap-8 min-w-0 shrink" data-section-path="overview.header-nav">
        <h1 class="shrink-0 text-lg font-black tracking-tighter text-primary font-headline sm:text-xl">系统概览</h1>
        <nav class="hidden md:flex gap-6 shrink-0" aria-label="本页子模块">
          <RouterLink
            :to="{ path: '/overview', hash: '#overview-dashboard' }"
            :class="subNavClass('#overview-dashboard', true)"
            >数据概览</RouterLink
          >
          <RouterLink
            :to="{ path: '/overview', hash: '#overview-agents' }"
            :class="subNavClass('#overview-agents')"
            >活跃智能体</RouterLink
          >
        </nav>
      </div>
      <div class="flex items-center gap-3 flex-1 justify-end min-w-0">
        <div class="relative w-full max-w-md group hidden sm:block">
          <span
            class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50"
            >search</span
          >
          <input
            v-model="searchQuery"
            class="nb-input w-full py-2.5 pl-12 pr-4 text-sm focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-on-surface-variant/40"
            placeholder="筛选动态与智能体…"
            type="search"
            autocomplete="off"
          />
        </div>
        <RouterLink
          to="/history"
          class="nb-btn nb-btn-neutral rounded-full p-2 transition-all flex items-center justify-center hover:bg-primary hover:text-on-primary"
          aria-label="历史会话"
        >
          <span class="material-symbols-outlined text-on-surface-variant">history</span>
        </RouterLink>
        <div class="h-8 w-[1px] bg-outline-variant/30 mx-1 hidden sm:block" />
        <RouterLink
          to="/chat"
          class="nb-btn nb-btn-primary px-5 py-2 rounded-full text-sm font-semibold active:scale-95 transition-all whitespace-nowrap"
        >
          新建对话
        </RouterLink>
      </div>
    </header>

    <div v-if="loadError" class="mx-auto max-w-[1600px] px-4 pt-4 sm:px-6 lg:px-8">
      <div
        class="rounded-2xl border border-error/20 bg-error/5 text-error px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-3"
        role="alert"
      >
        <span>{{ loadError }}</span>
        <button
          type="button"
          class="text-sm font-bold underline-offset-2 hover:underline"
          @click="loadDashboard"
        >
          重试
        </button>
      </div>
    </div>

    <div class="mx-auto max-w-[1600px] space-y-6 p-4 sm:space-y-8 sm:p-6 lg:p-8">
      <section
        id="overview-dashboard"
        class="scroll-mt-28 flex flex-col md:flex-row md:items-end justify-between gap-4"
      >
        <div>
          <h2 class="mb-2 text-2xl font-extrabold font-headline tracking-tight text-on-surface sm:text-4xl">
            系统概览 <span class="text-primary">.</span>
          </h2>
          <p class="text-on-surface-variant font-medium leading-relaxed">
            欢迎回来，{{ greetingName }}。以下是基于您账户真实数据的智能使用快照（近 30 天对比上一周期）。
          </p>
        </div>
        <div class="flex gap-2 flex-wrap">
          <div
            class="nb-pill nb-pill-tertiary px-4 py-2 rounded-xl flex items-center gap-3"
          >
            <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span class="text-xs font-bold text-on-surface">数据服务：已连接</span>
          </div>
        </div>
      </section>

      <!-- 摘要条 -->
      <section
        class="grid grid-cols-2 md:grid-cols-4 gap-4"
        aria-label="账户摘要"
      >
        <div
          class="nb-card rounded-2xl p-4"
        >
          <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">会话总数</p>
          <p class="text-2xl font-black font-headline mt-1">{{ summary.chatSessions.toLocaleString() }}</p>
        </div>
        <div
          class="nb-card rounded-2xl p-4"
        >
          <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">知识文档</p>
          <p class="text-2xl font-black font-headline mt-1">{{ summary.documents.toLocaleString() }}</p>
        </div>
        <div
          class="nb-card rounded-2xl p-4"
        >
          <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">向量块</p>
          <p class="text-2xl font-black font-headline mt-1">{{ summary.chunks.toLocaleString() }}</p>
        </div>
        <div
          class="nb-card rounded-2xl p-4"
        >
          <p class="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">近 30 天消息</p>
          <p class="text-2xl font-black font-headline mt-1">
            {{ (summary.userMessagesLast30d + summary.assistantMessagesLast30d).toLocaleString() }}
          </p>
          <p class="text-[10px] text-on-surface-variant/70 mt-1">
            用户 {{ summary.userMessagesLast30d }} · 助手 {{ summary.assistantMessagesLast30d }}
          </p>
        </div>
      </section>

      <div class="grid grid-cols-12 gap-6">
        <div class="col-span-12 lg:col-span-8 grid grid-cols-3 gap-4 relative">
          <div
            v-if="loading"
            class="absolute inset-0 z-10 bg-background/40 backdrop-blur-[2px] rounded-3xl flex items-center justify-center"
            aria-busy="true"
          >
            <div class="flex items-center gap-3 text-sm font-semibold text-on-surface-variant">
              <span
                class="inline-block h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin"
              />
              加载指标…
            </div>
          </div>
          <div
            class="nb-card bg-white p-6 rounded-2xl group hover:-translate-y-1 transition-transform"
          >
            <div class="flex justify-between items-start mb-4">
              <div class="p-2 bg-primary/10 rounded-lg text-primary">
                <span class="material-symbols-outlined">toll</span>
              </div>
              <span
                class="text-[10px] font-bold px-2 py-1 rounded"
                :class="tokenDeltaClass(metrics.tokenDeltaPct)"
                >{{ fmtPct(metrics.tokenDeltaPct) }}</span
              >
            </div>
            <p class="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">
              估算 Token（30 天）
            </p>
            <p class="text-[10px] text-on-surface-variant/60 mb-1">由消息字符量推算，非计费账单</p>
            <h3 class="text-2xl font-black font-headline tracking-tighter">
              {{ metrics.tokenUsage.toLocaleString() }}
            </h3>
          </div>
          <div
            class="nb-card bg-white p-6 rounded-2xl group hover:-translate-y-1 transition-transform"
          >
            <div class="flex justify-between items-start mb-4">
              <div class="p-2 bg-secondary-container/30 rounded-lg text-secondary">
                <span class="material-symbols-outlined">chat</span>
              </div>
              <span
                class="text-[10px] font-bold px-2 py-1 rounded"
                :class="apiDeltaClass(metrics.apiDeltaPct)"
                >{{ fmtPct(metrics.apiDeltaPct) }}</span
              >
            </div>
            <p class="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">
              用户消息（30 天）
            </p>
            <h3 class="text-2xl font-black font-headline tracking-tighter">
              {{ formatApiRequests(metrics.apiRequests) }}
            </h3>
          </div>
          <div
            class="nb-card bg-white p-6 rounded-2xl group hover:-translate-y-1 transition-transform"
          >
            <div class="flex justify-between items-start mb-4">
              <div class="p-2 bg-tertiary-container/30 rounded-lg text-tertiary">
                <span class="material-symbols-outlined">speed</span>
              </div>
              <span
                v-if="metrics.latencyDeltaMs != null"
                class="text-[10px] font-bold px-2 py-1 rounded"
                :class="latencyDeltaClass(metrics.latencyDeltaMs)"
                >{{ metrics.latencyDeltaMs >= 0 ? '+' : '' }}{{ metrics.latencyDeltaMs }}ms</span
              >
              <span
                v-else
                class="text-[10px] font-bold text-on-surface-variant bg-surface-container-low px-2 py-1 rounded"
                >—</span
              >
            </div>
            <p class="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">
              体感延迟参考
            </p>
            <p class="text-[10px] text-on-surface-variant/60 mb-1">由助手回复长度推导的趋势值</p>
            <h3 class="text-2xl font-black font-headline tracking-tighter">
              {{ formatLatency(metrics.avgLatencyMs)
              }}<span v-if="metrics.avgLatencyMs != null" class="text-sm font-medium ml-1">ms</span>
            </h3>
          </div>
          <div
            class="nb-card-lg col-span-3 p-8 rounded-3xl min-h-[320px] relative overflow-hidden"
          >
            <div class="flex justify-between items-center mb-8 flex-wrap gap-3">
              <div>
                <h4 class="text-lg font-bold font-headline">对话活跃趋势</h4>
                <p class="text-xs text-on-surface-variant mt-1">按用户消息计，每日/分段汇总</p>
              </div>
              <div class="flex gap-2" role="group" aria-label="趋势时间窗">
                <button
                  type="button"
                  class="nb-btn text-xs px-3 py-1.5 rounded-full font-bold transition-colors"
                  :class="
                    trendWindow === '7d'
                      ? 'bg-surface-container-low text-on-surface'
                      : 'text-on-surface-variant hover:bg-surface-container-low/60'
                  "
                  @click="setTrendWindow('7d')"
                >
                  7 天
                </button>
                <button
                  type="button"
                  class="nb-btn text-xs px-3 py-1.5 rounded-full font-bold transition-colors"
                  :class="
                    trendWindow === '30d'
                      ? 'bg-surface-container-low text-on-surface'
                      : 'text-on-surface-variant hover:bg-surface-container-low/60'
                  "
                  @click="setTrendWindow('30d')"
                >
                  30 天
                </button>
              </div>
            </div>
            <div v-if="trendBars.length" class="flex items-end justify-between h-40 gap-1.5 sm:gap-2">
              <div
                v-for="(bar, idx) in trendBars"
                :key="`${bar.label}-${idx}`"
                class="flex-1 min-w-0 flex flex-col items-center gap-2 group/bar"
              >
                <div
                  class="w-full bg-surface-container-high rounded-t-lg transition-all group-hover/bar:bg-primary max-h-[100%]"
                  :class="idx === trendPeakIdx && bar.count > 0 ? 'bg-primary/90' : ''"
                  :style="{ height: `${bar.heightPct}%` }"
                  :title="`${bar.label}：${bar.count} 条`"
                />
                <span
                  class="text-[9px] sm:text-[10px] text-on-surface-variant/70 font-medium truncate max-w-full text-center"
                  >{{ bar.label }}</span
                >
              </div>
            </div>
            <p v-else class="text-sm text-on-surface-variant py-12 text-center">暂无趋势数据</p>
            <div
              class="absolute inset-0 bg-gradient-to-t from-white/10 to-transparent pointer-events-none"
            />
          </div>
        </div>
        <div
          class="nb-card col-span-12 lg:col-span-4 rounded-3xl p-6 flex flex-col min-h-[320px]"
        >
          <div class="flex items-center justify-between mb-6 px-2">
            <h4 class="text-lg font-bold font-headline">最近动态</h4>
            <span class="material-symbols-outlined text-primary text-xl" aria-hidden="true">sensors</span>
          </div>
          <div class="flex-1 overflow-y-auto no-scrollbar space-y-4 max-h-[480px]">
            <template v-if="filteredActivity.length">
              <button
                v-for="item in filteredActivity"
                :key="item.id"
                type="button"
                class="nb-card w-full text-left p-4 rounded-2xl flex gap-4 hover:bg-tertiary/20 transition-colors"
                @click="goChatSession(item.sessionId)"
              >
                <div
                  class="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0"
                  :class="activityDotClass(item.role)"
                />
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2 gap-y-1">
                    <p class="text-sm font-bold truncate">{{ item.sessionTitle }}</p>
                    <span
                      class="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant"
                      >{{ activityBadge(item.role) }}</span
                    >
                  </div>
                  <p class="text-xs text-on-surface-variant mt-1 line-clamp-2">{{ item.snippet }}</p>
                  <span class="text-[10px] text-on-surface-variant/50 font-medium mt-2 block">
                    {{ timeAgoLabel(item.occurredAt) }}
                  </span>
                </div>
              </button>
            </template>
            <p v-else class="text-sm text-on-surface-variant text-center py-10 px-4">
              {{
                searchQuery.trim()
                  ? '没有匹配的动态，试试其他关键词'
                  : '还没有对话记录，去「智能对话」开始第一条吧。'
              }}
            </p>
          </div>
          <div class="mt-4 pt-4 border-t border-outline-variant/10">
            <RouterLink
              to="/chat"
              class="text-primary text-sm font-bold hover:underline inline-flex items-center gap-1"
            >
              打开智能对话
              <span class="material-symbols-outlined text-base">arrow_forward</span>
            </RouterLink>
          </div>
        </div>
        <div id="overview-agents" class="col-span-12 scroll-mt-28">
          <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
            <h4 class="text-2xl font-black font-headline tracking-tight">活跃智能体</h4>
            <RouterLink to="/market" class="text-primary text-sm font-bold hover:underline">查看市场</RouterLink>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <template v-for="agent in filteredAgents" :key="agent.id">
              <RouterLink
                v-if="agent.type === 'card'"
                :to="agent.linkTo || '/chat'"
                class="nb-card bg-white rounded-3xl p-6 flex flex-col gap-4 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <div class="flex justify-between items-start">
                  <div
                    class="w-14 h-14 rounded-2xl flex items-center justify-center"
                    :class="agent.iconBgClass"
                  >
                    <span
                      class="material-symbols-outlined text-3xl"
                      :class="agent.iconTextClass"
                      >{{ agent.icon }}</span
                    >
                  </div>
                  <div
                    class="px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1"
                    :class="agent.statusPillClass"
                  >
                    <span class="w-1.5 h-1.5 rounded-full" :class="agent.statusDotClass" />
                    {{ agent.status }}
                  </div>
                </div>
                <div>
                  <h5 class="text-lg font-bold font-headline mb-1">{{ agent.name }}</h5>
                  <p class="text-xs text-on-surface-variant leading-relaxed">{{ agent.description }}</p>
                  <div v-if="agent.tags?.length" class="flex flex-wrap gap-1.5 mt-3">
                    <span
                      v-for="tag in agent.tags.slice(0, 3)"
                      :key="tag"
                      class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant"
                      >{{ tag }}</span
                    >
                  </div>
                </div>
                <div class="pt-4 border-t border-surface-container flex justify-between items-center">
                  <span class="text-[10px] font-bold text-primary">去对话</span>
                  <span class="material-symbols-outlined text-sm text-on-surface-variant">chevron_right</span>
                </div>
              </RouterLink>
              <RouterLink
                v-else
                :to="agent.linkTo || '/market'"
                class="group flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-3xl border-2 border-black bg-white p-6 shadow-[6px_6px_0_#141414] outline-none transition-[transform,box-shadow,background-color,color] duration-150 ease-out hover:-translate-x-px hover:-translate-y-px hover:bg-primary/[0.08] hover:shadow-[8px_8px_0_#141414] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:translate-x-px active:translate-y-px active:shadow-[4px_4px_0_#141414]"
              >
                <div
                  class="flex h-12 w-12 items-center justify-center rounded-full border-2 border-black bg-[#f5f1ea] text-on-surface transition-colors duration-150 group-hover:bg-primary group-hover:text-on-primary"
                >
                  <span class="material-symbols-outlined">add</span>
                </div>
                <span
                  class="text-center text-sm font-bold text-on-surface-variant transition-colors duration-150 group-hover:text-primary"
                  >{{ agent.name }}</span
                >
                <span class="text-[10px] text-on-surface-variant/70 text-center px-2">{{
                  agent.description
                }}</span>
              </RouterLink>
            </template>
          </div>
          <p
            v-if="searchQuery.trim() && !filteredAgents.length"
            class="text-sm text-on-surface-variant text-center py-8"
          >
            没有匹配的智能体
          </p>
        </div>
      </div>
    </div>
    <RouterLink
      to="/chat"
      class="fixed bottom-8 right-8 w-16 h-16 bg-primary text-on-primary rounded-full shadow-2xl shadow-primary/40 flex items-center justify-center active:scale-90 transition-transform z-50"
      aria-label="打开智能对话"
    >
      <span class="material-symbols-outlined text-3xl" style="font-variation-settings: 'FILL' 1"
        >smart_toy</span
      >
    </RouterLink>
  </main>
</template>
