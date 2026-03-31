<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useSubNav } from '../composables/useSubNav'
import { apiFetch } from '../lib/apiClient'
import { useAuth } from '../composables/useAuth'

type AgentCard = {
  id: string
  category: string
  name: string
  description: string
  rating: number
  tags: string[]
  iconKey: string
  sortOrder: number
  isFeatured: boolean
  welcomeHint?: string | null
  suggestedModel?: string | null
  pinned: boolean
}

type MarketPayload = {
  catalog: AgentCard[]
  categories: string[]
  pinnedIds: string[]
  enterpriseFeature: {
    title: string
    body: string
    primaryCta: string
    secondaryCta: string
  }
  knowledgeHub: {
    title: string
    body: string
    tags: string[]
  }
}

const ICON_MAP: Record<string, string> = {
  query_stats: 'query_stats',
  trending_up: 'trending_up',
  dns: 'dns',
  edit_note: 'edit_note',
  gavel: 'gavel',
  menu_book: 'menu_book',
  smart_toy: 'smart_toy',
  security: 'security',
}

const { subNavClass } = useSubNav()
const { loginIfNeeded, user, fetchMe } = useAuth()
const router = useRouter()

const catalog = ref<AgentCard[]>([])
const categories = ref<string[]>([])
const pinnedIds = ref<string[]>([])
const enterpriseFeature = ref<MarketPayload['enterpriseFeature']>({
  title: '定制您的专属智能体？',
  body: '',
  primaryCta: '联系专家',
  secondaryCta: '查看案例',
})
const knowledgeHub = ref<MarketPayload['knowledgeHub']>({
  title: '知识智能管家',
  body: '',
  tags: [],
})

const loading = ref(true)
const listError = ref<string | null>(null)
const searchQuery = ref('')
const selectedCategory = ref<string>('')
const detailAgent = ref<AgentCard | null>(null)
const detailOpen = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null
const searchDebounced = ref('')

const categoryChips = computed(() => {
  const base = [{ label: '全部', value: '' }]
  for (const c of categories.value) base.push({ label: c, value: c })
  return base
})

const pinnedCount = computed(() => pinnedIds.value.length)

function iconSymbol(key: string) {
  return ICON_MAP[key] || 'smart_toy'
}

function cardAccent(idx: number) {
  const palettes = [
    { box: 'bg-primary-container/30 text-primary', cat: 'text-primary' },
    { box: 'bg-secondary-container/30 text-secondary', cat: 'text-secondary' },
    { box: 'bg-tertiary-container/30 text-tertiary', cat: 'text-tertiary' },
  ] as const
  return palettes[idx % palettes.length]
}

function parseApiError(raw: string): string {
  const s = String(raw || '').trim()
  try {
    const j = JSON.parse(s) as { message?: string | string[] }
    const m = j.message
    if (Array.isArray(m)) return m.filter(Boolean).join('；')
    if (typeof m === 'string') return m
  } catch {
    /* ignore */
  }
  return s.length > 280 ? `${s.slice(0, 280)}…` : s || '加载失败'
}

async function loadMarket() {
  loading.value = true
  listError.value = null
  try {
    const params = new URLSearchParams()
    if (selectedCategory.value) params.set('category', selectedCategory.value)
    if (searchDebounced.value.trim()) params.set('q', searchDebounced.value.trim())
    const qs = params.toString()
    const path = qs ? `/market?${qs}` : '/market'
    const data = await apiFetch<MarketPayload>(path, { method: 'GET' })
    catalog.value = data.catalog || []
    categories.value = data.categories || []
    pinnedIds.value = data.pinnedIds || []
    if (data.enterpriseFeature) enterpriseFeature.value = { ...enterpriseFeature.value, ...data.enterpriseFeature }
    if (data.knowledgeHub) knowledgeHub.value = { ...knowledgeHub.value, ...data.knowledgeHub }
  } catch (e: any) {
    listError.value = parseApiError(String(e?.message || e))
    catalog.value = []
  } finally {
    loading.value = false
  }
}

watch(searchQuery, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchDebounced.value = searchQuery.value
  }, 360)
})

watch(searchDebounced, () => {
  loadMarket()
})

watch(selectedCategory, () => {
  loadMarket()
})

function selectCategory(value: string) {
  selectedCategory.value = value
}

function pinIconStyle(pinned: boolean) {
  return pinned ? { fontVariationSettings: "'FILL' 1" as string } : {}
}

async function togglePin(agent: AgentCard, ev: Event) {
  ev.stopPropagation()
  listError.value = null
  try {
    if (agent.pinned) {
      await apiFetch(`/market/agents/${encodeURIComponent(agent.id)}/pin`, { method: 'DELETE' })
    } else {
      await apiFetch(`/market/agents/${encodeURIComponent(agent.id)}/pin`, { method: 'POST' })
    }
    await loadMarket()
    if (detailAgent.value?.id === agent.id) {
      const u = catalog.value.find((a) => a.id === agent.id)
      if (u) detailAgent.value = u
    }
  } catch (e: any) {
    listError.value = parseApiError(String(e?.message || e))
  }
}

function openDetail(agent: AgentCard) {
  detailAgent.value = agent
  detailOpen.value = true
}

function closeDetail() {
  detailOpen.value = false
  detailAgent.value = null
}

function startChat(agent: AgentCard) {
  const hint = (agent.welcomeHint || '').trim()
  router.push({
    path: '/chat',
    query: {
      agent: agent.id,
      agentLaunch: String(Date.now()),
      ...(agent.name ? { agentName: agent.name } : {}),
      ...(hint ? { agentHint: hint } : {}),
      ...(agent.suggestedModel ? { agentModel: agent.suggestedModel } : {}),
    },
  })
}

onMounted(async () => {
  const token = await loginIfNeeded()
  if (!token) return
  if (!user.value) await fetchMe()
  await loadMarket()
})
</script>

<template>
  <main data-page-route="/market" class="min-h-screen relative bg-background text-on-background">
    <header
      class="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-40 flex w-full items-center justify-between gap-3 border-b-4 border-black bg-background px-4 py-3 shadow-xl sm:gap-6 sm:px-6 sm:py-4 lg:top-0 lg:px-8"
    >
      <div class="flex items-center gap-8 min-w-0 shrink" data-section-path="market.header-nav">
        <h1 class="shrink-0 text-lg font-black tracking-tighter text-primary font-headline sm:text-xl">智能体市场</h1>
        <nav class="hidden md:flex gap-6 shrink-0" aria-label="本页子模块">
          <RouterLink
            :to="{ path: '/market', hash: '#market-catalog' }"
            :class="subNavClass('#market-catalog', true)"
            >智能体目录</RouterLink
          >
          <RouterLink
            :to="{ path: '/market', hash: '#market-enterprise' }"
            :class="subNavClass('#market-enterprise')"
            >企业定制</RouterLink
          >
        </nav>
      </div>
      <div class="flex items-center gap-4 flex-1 justify-end min-w-0">
        <div class="relative w-full max-w-xl group hidden sm:block">
          <span
            class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant opacity-50"
            >search</span
          >
          <input
            v-model="searchQuery"
            class="nb-input w-full py-2.5 pl-12 pr-4 focus:ring-2 focus:ring-primary/20 text-sm transition-all"
            placeholder="搜索名称、描述、标签或分类…"
            type="search"
            autocomplete="off"
          />
        </div>
        <RouterLink
          to="/chat"
          class="hidden sm:inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >去对话</RouterLink
        >
        <div class="h-8 w-[1px] bg-outline-variant/30 mx-1 hidden sm:block"></div>
        <div class="flex items-center gap-3 min-w-0">
          <div class="text-right hidden sm:block truncate max-w-[180px]">
            <p class="text-xs font-bold leading-none truncate">{{ user?.email || '已登录' }}</p>
            <p class="text-[10px] text-on-surface-variant leading-none mt-1">智能体市场</p>
          </div>
          <div
            class="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold shrink-0"
          >
            {{ (user?.email || '?').slice(0, 1).toUpperCase() }}
          </div>
        </div>
      </div>
    </header>

    <div class="mx-auto max-w-7xl space-y-6 p-4 pb-24 sm:space-y-10 sm:p-6 lg:p-10">
      <div
        v-if="listError"
        class="rounded-xl border border-error/25 bg-error/5 text-error px-4 py-3 text-sm"
        role="alert"
      >
        {{ listError }}
      </div>

      <section id="market-catalog" class="scroll-mt-28 relative space-y-4">
        <div
          class="nb-pill nb-pill-tertiary inline-flex items-center px-3 py-1 rounded-full text-xs font-bold gap-2"
        >
          <span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1"
            >auto_awesome</span
          >
          目录由服务端维护 · 支持分类筛选与收藏置顶
        </div>
        <h1 class="text-3xl font-black font-headline tracking-tight text-on-surface sm:text-5xl">
          智能体市场 <span class="text-primary">Marketplace</span>
        </h1>
        <p class="text-lg text-on-surface-variant max-w-2xl leading-relaxed">
          浏览场景化智能体，一键置顶常用角色，并从市场直接跳转到对话页开始协作。
        </p>
        <p v-if="pinnedCount > 0" class="text-sm text-primary font-semibold">
          已置顶 {{ pinnedCount }} 个 · 排序优先展示
        </p>
      </section>

      <div class="sm:hidden">
        <input
          v-model="searchQuery"
          type="search"
          class="w-full rounded-full bg-surface-container-low px-4 py-2.5 text-sm"
          placeholder="搜索智能体…"
        />
      </div>

      <section class="flex flex-wrap items-center gap-2">
        <button
          v-for="chip in categoryChips"
          :key="chip.value || 'all'"
          type="button"
          class="nb-btn px-5 py-2 rounded-full font-label text-sm font-medium transition-colors"
          :class="
            selectedCategory === chip.value
              ? 'bg-primary text-on-primary shadow-lg shadow-primary/20'
              : 'bg-surface-container-low hover:bg-surface-container-high text-on-surface'
          "
          @click="selectCategory(chip.value)"
        >
          {{ chip.label }}
        </button>
      </section>

      <section v-if="loading" class="py-16 text-center text-on-surface-variant text-sm">加载目录中…</section>

      <section v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
        <div
          v-for="(agent, idx) in catalog"
          :key="agent.id"
          role="button"
          tabindex="0"
          class="nb-card-lg rounded-2xl p-8 flex flex-col gap-6 group hover:translate-y-[-4px] transition-all duration-300 cursor-pointer text-left"
          @click="openDetail(agent)"
          @keyup.enter="openDetail(agent)"
        >
          <div class="flex justify-between items-start gap-2">
            <div
              class="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
              :class="cardAccent(idx).box"
            >
              <span
                class="material-symbols-outlined text-3xl"
                style="font-variation-settings: 'FILL' 1"
                :aria-hidden="true"
              >
                {{ iconSymbol(agent.iconKey) }}
              </span>
            </div>
            <div class="flex flex-col items-end gap-1 shrink-0">
              <button
                type="button"
                class="rounded-full p-2 hover:bg-surface-container-low text-on-surface-variant"
                :title="agent.pinned ? '取消置顶' : '置顶'"
                aria-label="toggle pin"
                @click="togglePin(agent, $event)"
              >
                <span class="material-symbols-outlined text-xl" :style="pinIconStyle(agent.pinned)"
                  >push_pin</span
                >
              </button>
              <span
                class="text-[10px] font-bold tracking-widest uppercase"
                :class="cardAccent(idx).cat"
              >
                {{ agent.category }}
              </span>
              <div v-if="agent.isFeatured" class="text-[9px] font-bold text-primary uppercase tracking-wider">
                Featured
              </div>
              <div class="flex gap-1 text-tertiary items-center">
                <span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1"
                  >star</span
                >
                <span class="text-xs font-bold">{{ agent.rating.toFixed(1) }}</span>
              </div>
            </div>
          </div>
          <div class="space-y-2">
            <h3 class="text-xl font-bold font-headline">{{ agent.name }}</h3>
            <p class="text-sm text-on-surface-variant line-clamp-3 leading-relaxed">
              {{ agent.description }}
            </p>
          </div>
          <div class="space-y-4 pt-4 border-t border-surface-container">
            <p class="text-[11px] font-bold text-on-surface-variant/60 tracking-wider">核心能力</p>
            <div class="flex flex-wrap gap-2">
              <span
                v-for="t in (agent.tags || []).slice(0, 5)"
                :key="t"
                class="px-3 py-1 rounded-full bg-surface-container-low text-[11px] font-medium text-on-surface"
              >
                {{ t }}
              </span>
            </div>
          </div>
          <button
            type="button"
            class="mt-auto w-full py-3 bg-primary text-on-primary rounded-xl font-bold flex items-center justify-center gap-2 hover:opacity-95 transition-opacity"
            @click.stop="startChat(agent)"
          >
            <span>开始对话</span>
            <span class="material-symbols-outlined text-sm">chat</span>
          </button>
        </div>
      </section>

      <section v-if="!loading && catalog.length === 0" class="text-center py-12 text-on-surface-variant text-sm">
        没有匹配的智能体，试试其它分类或清空搜索。
      </section>

      <section id="market-enterprise" class="scroll-mt-28 grid grid-cols-1 xl:grid-cols-3 gap-8">
        <RouterLink
          to="/knowledge"
          class="nb-card-lg rounded-2xl p-8 flex flex-col gap-6 group hover:translate-y-[-4px] transition-all duration-300 no-underline text-inherit"
        >
          <div class="flex justify-between items-start">
            <div
              class="w-14 h-14 rounded-2xl bg-primary-container/30 flex items-center justify-center text-primary"
            >
              <span
                class="material-symbols-outlined text-3xl"
                style="font-variation-settings: 'FILL' 1"
                >menu_book</span
              >
            </div>
            <div class="flex flex-col items-end">
              <span class="text-[10px] font-bold text-primary tracking-widest uppercase mb-1">知识库</span>
              <div class="flex gap-1 text-tertiary">
                <span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1"
                  >arrow_forward</span
                >
              </div>
            </div>
          </div>
          <div class="space-y-2">
            <h3 class="text-xl font-bold font-headline">{{ knowledgeHub.title }}</h3>
            <p class="text-sm text-on-surface-variant line-clamp-3 leading-relaxed">
              {{ knowledgeHub.body }}
            </p>
          </div>
          <div class="space-y-4 pt-4 border-t border-surface-container">
            <p class="text-[11px] font-bold text-on-surface-variant/60 tracking-wider">能力标签</p>
            <div class="flex flex-wrap gap-2">
              <span
                v-for="t in knowledgeHub.tags || []"
                :key="t"
                class="px-3 py-1 rounded-full bg-surface-container-low text-[11px] font-medium text-on-surface"
                >{{ t }}</span
              >
            </div>
          </div>
          <span
            class="mt-auto w-full py-3 bg-primary text-on-primary rounded-xl font-bold flex items-center justify-center gap-2"
          >
            管理知识库
            <span class="material-symbols-outlined text-sm">library_books</span>
          </span>
        </RouterLink>

        <div
          class="xl:col-span-2 rounded-2xl p-8 md:p-10 text-white bg-gradient-to-br from-[#4638db] via-[#5b46eb] to-[#7a63f2] shadow-xl relative overflow-hidden"
        >
          <div
            class="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-white/10 blur-2xl pointer-events-none"
          ></div>
          <div class="flex items-center justify-between gap-8 relative z-10">
            <div class="max-w-xl">
              <span
                class="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold tracking-widest bg-white/20"
                >企业功能</span
              >
              <h3 class="text-3xl font-black font-headline mt-4">{{ enterpriseFeature.title }}</h3>
              <p class="text-sm text-white/80 mt-3 leading-relaxed">
                {{ enterpriseFeature.body }}
              </p>
              <div class="flex flex-wrap items-center gap-3 mt-6">
                <a
                  class="px-5 py-2.5 rounded-xl bg-white text-primary font-bold text-sm hover:bg-white/90 transition-colors no-underline inline-flex items-center justify-center"
                  href="mailto:sales@example.com?subject=智能体企业定制咨询"
                >
                  {{ enterpriseFeature.primaryCta }}
                </a>
                <RouterLink
                  to="/overview"
                  class="px-5 py-2.5 rounded-xl border border-white/40 text-white font-bold text-sm hover:bg-white/10 transition-colors no-underline inline-flex items-center justify-center"
                >
                  {{ enterpriseFeature.secondaryCta }}
                </RouterLink>
              </div>
            </div>
            <div
              class="hidden md:flex w-32 h-32 rounded-2xl bg-white/12 border border-white/20 items-center justify-center backdrop-blur-sm"
            >
              <span class="material-symbols-outlined text-5xl" style="font-variation-settings: 'FILL' 1"
                >autorenew</span
              >
            </div>
          </div>
        </div>
      </section>

      <section class="flex items-center justify-center gap-6 pt-1 pb-4 text-[11px] text-outline flex-wrap">
        <span class="inline-flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-primary"></span>
          目录数据来自 PostgreSQL · 可扩展运营后台
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="material-symbols-outlined text-xs">verified</span>
          JWT 隔离 · 收藏按用户存储
        </span>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="detailOpen && detailAgent"
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/45 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        :aria-label="detailAgent.name"
        @click.self="closeDetail"
      >
        <div
          class="nb-card-lg w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-6 space-y-4"
          @click.stop
        >
          <div class="flex justify-between items-start gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="w-12 h-12 rounded-xl bg-primary-container/30 text-primary flex items-center justify-center shrink-0"
              >
                <span class="material-symbols-outlined text-2xl" style="font-variation-settings: 'FILL' 1">{{
                  iconSymbol(detailAgent.iconKey)
                }}</span>
              </div>
              <div class="min-w-0">
                <h4 class="font-headline font-bold text-lg truncate">{{ detailAgent.name }}</h4>
                <p class="text-xs text-on-surface-variant">{{ detailAgent.category }}</p>
              </div>
            </div>
            <button
              type="button"
              class="p-2 rounded-full hover:bg-surface-container-low shrink-0"
              aria-label="关闭"
              @click="closeDetail"
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <p class="text-sm text-on-surface-variant leading-relaxed">{{ detailAgent.description }}</p>
          <div v-if="detailAgent.welcomeHint" class="rounded-xl bg-surface-container-low p-3 text-sm">
            <p class="text-[10px] font-bold text-outline uppercase tracking-wider mb-1">对话预填</p>
            <p class="text-on-surface whitespace-pre-wrap">{{ detailAgent.welcomeHint }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="t in detailAgent.tags || []"
              :key="t"
              class="px-2.5 py-1 rounded-full bg-surface-container-low text-[11px]"
              >{{ t }}</span
            >
          </div>
          <div class="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="button"
              class="flex-1 py-3 bg-primary text-on-primary rounded-xl font-bold"
              @click="startChat(detailAgent); closeDetail()"
            >
              开始对话
            </button>
            <button
              type="button"
              class="flex-1 py-3 border border-outline-variant/30 rounded-xl font-bold"
              @click="togglePin(detailAgent, $event)"
            >
              {{ detailAgent.pinned ? '取消置顶' : '置顶' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </main>
</template>
