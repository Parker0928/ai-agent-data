<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useSubNav } from '../composables/useSubNav'
import { apiFetch } from '../lib/apiClient'
import { useAuth } from '../composables/useAuth'

type SessionRow = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  archived: boolean
  archivedAt: string | null
  messageCount: number
  preview: string
  status: string
  category: string
}

type HistoryListResponse = {
  items: SessionRow[]
  page: number
  limit: number
  total: number
  hasMore: boolean
}

type HistoryStats = {
  total: number
  active: number
  archived: number
  updatedLast7Days: number
  messagesTotal: number
}

const { subNavClass } = useSubNav()
const { loginIfNeeded, user, fetchMe } = useAuth()
const router = useRouter()

const sessions = ref<SessionRow[]>([])
const stats = ref<HistoryStats | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const pageError = ref<string | null>(null)

const searchInput = ref('')
const searchDebounced = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null

/** active | archived | all */
const scope = ref<'active' | 'archived' | 'all'>('active')
const days = ref<number>(0)
const limit = 20
const lastLoadedPage = ref(0)
const totalCount = ref(0)

const selectedIds = ref<Set<string>>(new Set())
const renameTarget = ref<SessionRow | null>(null)
const renameDraft = ref('')

const allSelectedOnPage = computed(() => {
  if (sessions.value.length === 0) return false
  return sessions.value.every((s) => selectedIds.value.has(s.id))
})

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
  return s.length > 400 ? `${s.slice(0, 400)}…` : s || '操作失败'
}

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function toggleSelectAllOnPage() {
  if (allSelectedOnPage.value) {
    const next = new Set(selectedIds.value)
    for (const s of sessions.value) next.delete(s.id)
    selectedIds.value = next
  } else {
    const next = new Set(selectedIds.value)
    for (const s of sessions.value) next.add(s.id)
    selectedIds.value = next
  }
}

function clearSelection() {
  selectedIds.value = new Set()
}

async function loadStats() {
  try {
    stats.value = await apiFetch<HistoryStats>('/history/stats', { method: 'GET' })
  } catch {
    stats.value = null
  }
}

function buildListPath(pageNum: number) {
  const params = new URLSearchParams()
  if (searchDebounced.value.trim()) params.set('q', searchDebounced.value.trim())
  if (days.value > 0) params.set('days', String(days.value))
  params.set('scope', scope.value)
  params.set('page', String(pageNum))
  params.set('limit', String(limit))
  const qs = params.toString()
  return `/history/sessions?${qs}`
}

async function loadList() {
  loading.value = true
  lastLoadedPage.value = 0
  pageError.value = null
  try {
    const data = await apiFetch<HistoryListResponse>(buildListPath(1), { method: 'GET' })
    sessions.value = data.items || []
    lastLoadedPage.value = data.page || 1
    totalCount.value = data.total ?? 0
  } catch (e: any) {
    pageError.value = parseApiError(String(e?.message || e))
    sessions.value = []
    totalCount.value = 0
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || loading.value) return
  if (sessions.value.length >= totalCount.value) return
  const nextPage = lastLoadedPage.value + 1
  loadingMore.value = true
  pageError.value = null
  try {
    const data = await apiFetch<HistoryListResponse>(buildListPath(nextPage), { method: 'GET' })
    sessions.value = [...sessions.value, ...(data.items || [])]
    lastLoadedPage.value = data.page || nextPage
    totalCount.value = data.total ?? totalCount.value
  } catch (e: any) {
    pageError.value = parseApiError(String(e?.message || e))
  } finally {
    loadingMore.value = false
  }
}

watch(searchInput, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchDebounced.value = searchInput.value
  }, 380)
})

watch(searchDebounced, () => {
  clearSelection()
  loadList()
})

watch([scope, days], () => {
  clearSelection()
  loadList()
})

async function bulkDelete() {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0) return
  if (!window.confirm(`确定删除选中的 ${ids.length} 个会话？消息将一并删除且不可恢复。`)) return
  try {
    await apiFetch('/history/sessions/bulk-delete', { method: 'POST', json: { ids } })
    clearSelection()
    await Promise.all([loadList(), loadStats()])
  } catch (e: any) {
    pageError.value = parseApiError(String(e?.message || e))
  }
}

async function bulkArchive() {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0) return
  try {
    await apiFetch('/history/sessions/bulk-archive', { method: 'POST', json: { ids } })
    clearSelection()
    await Promise.all([loadList(), loadStats()])
  } catch (e: any) {
    pageError.value = parseApiError(String(e?.message || e))
  }
}

async function bulkUnarchive() {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0) return
  try {
    await apiFetch('/history/sessions/bulk-unarchive', { method: 'POST', json: { ids } })
    clearSelection()
    await Promise.all([loadList(), loadStats()])
  } catch (e: any) {
    pageError.value = parseApiError(String(e?.message || e))
  }
}

async function deleteOne(s: SessionRow, ev: Event) {
  ev.stopPropagation()
  if (!window.confirm(`删除会话「${s.title}」？`)) return
  try {
    await apiFetch(`/chat/sessions/${s.id}/delete`, { method: 'POST' })
    selectedIds.value.delete(s.id)
    selectedIds.value = new Set(selectedIds.value)
    await Promise.all([loadList(), loadStats()])
  } catch (e: any) {
    pageError.value = parseApiError(String(e?.message || e))
  }
}

async function archiveOne(s: SessionRow, ev: Event) {
  ev.stopPropagation()
  try {
    await apiFetch(`/history/sessions/${s.id}/archive`, { method: 'POST' })
    await Promise.all([loadList(), loadStats()])
  } catch (e: any) {
    pageError.value = parseApiError(String(e?.message || e))
  }
}

async function unarchiveOne(s: SessionRow, ev: Event) {
  ev.stopPropagation()
  try {
    await apiFetch(`/history/sessions/${s.id}/unarchive`, { method: 'POST' })
    await Promise.all([loadList(), loadStats()])
  } catch (e: any) {
    pageError.value = parseApiError(String(e?.message || e))
  }
}

function openRename(s: SessionRow, ev: Event) {
  ev.stopPropagation()
  renameTarget.value = s
  renameDraft.value = s.title
}

function closeRename() {
  renameTarget.value = null
  renameDraft.value = ''
}

async function commitRename() {
  const s = renameTarget.value
  if (!s) return
  const t = renameDraft.value.trim()
  if (!t) {
    closeRename()
    return
  }
  try {
    await apiFetch(`/chat/sessions/${s.id}`, { method: 'PATCH', json: { title: t } })
    closeRename()
    await loadList()
  } catch (e: any) {
    pageError.value = parseApiError(String(e?.message || e))
  }
}

function continueChat(s: SessionRow) {
  router.push({ path: '/chat', query: { session: s.id } })
}

const hasMore = computed(() => totalCount.value > 0 && sessions.value.length < totalCount.value)

onMounted(async () => {
  const token = await loginIfNeeded()
  if (!token) return
  if (!user.value) await fetchMe()
  await loadStats()
  await loadList()
})
</script>

<template>
  <main data-page-route="/history" class="min-h-screen relative bg-background text-on-background pb-16">
    <header
      class="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-50 flex w-full items-center justify-between gap-2 border-b-4 border-black bg-background px-4 py-3 shadow-xl sm:gap-4 sm:px-6 sm:py-4 lg:top-0 lg:px-8"
    >
      <div class="flex items-center gap-8 min-w-0" data-section-path="history.header-nav">
        <h1 class="shrink-0 text-lg font-black tracking-tighter text-primary font-headline sm:text-xl">历史会话</h1>
        <nav class="hidden md:flex gap-6 shrink-0" aria-label="本页子模块">
          <RouterLink
            :to="{ path: '/history', hash: '#history-toolbar' }"
            :class="subNavClass('#history-toolbar', true)"
            >筛选与操作</RouterLink
          >
          <RouterLink
            :to="{ path: '/history', hash: '#history-sessions' }"
            :class="subNavClass('#history-sessions')"
            >会话列表</RouterLink
          >
        </nav>
      </div>
      <div class="flex items-center gap-4 flex-1 justify-end min-w-0">
        <div class="relative hidden lg:block max-w-md flex-1">
          <span
            class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg"
            >search</span
          >
          <input
            v-model="searchInput"
            class="w-full bg-surface-container-low border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/20 transition-all"
            placeholder="按标题搜索…"
            type="search"
            autocomplete="off"
          />
        </div>
        <RouterLink
          to="/chat"
          class="hidden sm:inline text-sm font-semibold text-primary hover:underline shrink-0"
          >去对话</RouterLink
        >
        <div class="flex items-center gap-2 shrink-0">
          <div class="text-right hidden sm:block max-w-[160px]">
            <p class="text-xs font-bold truncate">{{ user?.email || '已登录' }}</p>
          </div>
          <div
            class="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-sm"
          >
            {{ (user?.email || '?').slice(0, 1).toUpperCase() }}
          </div>
        </div>
      </div>
    </header>

    <div class="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <div
        v-if="stats"
        class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8 text-sm"
      >
        <div class="nb-card rounded-xl p-4">
          <p class="text-on-surface-variant text-xs">总会话</p>
          <p class="text-2xl font-black font-headline text-on-surface mt-1">{{ stats.total }}</p>
        </div>
        <div class="nb-card rounded-xl p-4">
          <p class="text-on-surface-variant text-xs">进行中</p>
          <p class="text-2xl font-black font-headline text-primary mt-1">{{ stats.active }}</p>
        </div>
        <div class="nb-card rounded-xl p-4">
          <p class="text-on-surface-variant text-xs">已归档</p>
          <p class="text-2xl font-black font-headline text-amber-700 mt-1">{{ stats.archived }}</p>
        </div>
        <div class="nb-card rounded-xl p-4">
          <p class="text-on-surface-variant text-xs">近 7 天有更新</p>
          <p class="text-2xl font-black font-headline text-on-surface mt-1">{{ stats.updatedLast7Days }}</p>
        </div>
      </div>

      <div
        v-if="pageError"
        class="mb-6 rounded-xl border border-error/25 bg-error/5 text-error px-4 py-3 text-sm"
        role="alert"
      >
        {{ pageError }}
      </div>

      <div
        id="history-toolbar"
        class="scroll-mt-28 flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4 mb-6"
      >
        <div class="flex flex-col sm:flex-row flex-wrap gap-2 sm:items-center">
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="nb-btn px-4 py-2 rounded-full text-sm font-semibold transition-colors"
              :class="scope === 'active' ? 'nb-btn-primary text-on-primary' : 'nb-btn-neutral text-on-surface'"
              @click="scope = 'active'"
            >
              进行中
            </button>
            <button
              type="button"
              class="nb-btn px-4 py-2 rounded-full text-sm font-semibold transition-colors"
              :class="scope === 'archived' ? 'nb-btn-secondary text-on-secondary' : 'nb-btn-neutral text-on-surface'"
              @click="scope = 'archived'"
            >
              已归档
            </button>
            <button
              type="button"
              class="nb-btn px-4 py-2 rounded-full text-sm font-semibold transition-colors"
              :class="scope === 'all' ? 'nb-pill-tertiary text-on-tertiary' : 'nb-btn-neutral text-on-surface'"
              @click="scope = 'all'"
            >
              全部
            </button>
          </div>
          <div class="flex flex-wrap gap-2 items-center">
            <span class="text-xs text-on-surface-variant hidden sm:inline">时间：</span>
            <button
              v-for="d in [
                { v: 0, l: '不限' },
                { v: 7, l: '7 天' },
                { v: 30, l: '30 天' },
                { v: 90, l: '90 天' },
              ]"
              :key="d.v"
              type="button"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
              :class="
                days === d.v
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-low'
              "
              @click="days = d.v"
            >
              {{ d.l }}
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 bg-surface-container-high/40 p-2 rounded-2xl">
          <span class="text-xs text-on-surface-variant px-2">已选 {{ selectedIds.size }}</span>
          <button
            type="button"
            :disabled="selectedIds.size === 0"
            class="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-error hover:bg-error/10 rounded-xl disabled:opacity-40"
            @click="bulkDelete"
          >
            <span class="material-symbols-outlined text-lg">delete</span>
            删除
          </button>
          <button
            type="button"
            :disabled="selectedIds.size === 0 || scope === 'archived'"
            class="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-on-surface hover:bg-surface-container-low rounded-xl disabled:opacity-40"
            title="归档后将从对话侧栏隐藏，可在此恢复"
            @click="bulkArchive"
          >
            <span class="material-symbols-outlined text-lg">archive</span>
            归档
          </button>
          <button
            type="button"
            :disabled="selectedIds.size === 0 || scope === 'active'"
            class="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10 rounded-xl disabled:opacity-40"
            @click="bulkUnarchive"
          >
            <span class="material-symbols-outlined text-lg">unarchive</span>
            恢复
          </button>
        </div>
      </div>

      <div class="lg:hidden mb-4">
        <input
          v-model="searchInput"
          type="search"
          class="w-full rounded-xl bg-surface-container-low px-4 py-2.5 text-sm"
          placeholder="搜索标题…"
        />
      </div>

      <div
        v-if="!loading && sessions.length > 0"
        class="flex items-center gap-3 mb-3 text-xs text-on-surface-variant"
      >
        <label class="inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" class="rounded border-outline-variant" :checked="allSelectedOnPage" @change="toggleSelectAllOnPage" />
          全选本页
        </label>
        <button type="button" class="underline" @click="clearSelection">清空选择</button>
      </div>

      <div id="history-sessions" class="scroll-mt-28 grid grid-cols-1 gap-3">
        <div v-if="loading" class="py-20 text-center text-on-surface-variant text-sm">加载中…</div>
        <button
          v-for="s in sessions"
          v-else
          :key="s.id"
          type="button"
          class="nb-card group rounded-2xl p-5 hover:shadow-[8px_8px_0_#141414] flex items-start gap-4 text-left w-full transition-all"
          @click="continueChat(s)"
        >
          <input
            type="checkbox"
            class="mt-1 rounded border-outline-variant shrink-0"
            :checked="selectedIds.has(s.id)"
            @click.stop
            @change="toggleSelect(s.id)"
          />
          <div
            class="flex-shrink-0 w-12 h-12 bg-primary-container/20 rounded-xl flex items-center justify-center"
          >
            <span class="material-symbols-outlined text-primary" style="font-variation-settings: 'FILL' 1"
              >forum</span
            >
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2 mb-1">
              <span
                class="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold uppercase rounded"
                >{{ s.category }}</span
              >
              <span
                v-if="s.archived"
                class="px-2 py-0.5 bg-amber-100 text-amber-900 text-[10px] font-bold rounded"
                >已归档</span
              >
              <span class="text-on-surface-variant text-xs">
                {{ s.messageCount }} 条消息 · 更新 {{ new Date(s.updatedAt).toLocaleString() }}
              </span>
            </div>
            <h3 class="text-base font-bold text-on-surface truncate">{{ s.title }}</h3>
            <p class="text-sm text-on-surface-variant line-clamp-2 mt-1">{{ s.preview }}</p>
          </div>
          <div class="flex flex-col sm:flex-row items-end sm:items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              class="p-2 hover:bg-surface-container-high rounded-lg text-on-surface-variant"
              title="继续对话"
              @click.stop="continueChat(s)"
            >
              <span class="material-symbols-outlined text-lg">chat</span>
            </button>
            <button
              type="button"
              class="p-2 hover:bg-surface-container-high rounded-lg text-on-surface-variant"
              title="重命名"
              @click="openRename(s, $event)"
            >
              <span class="material-symbols-outlined text-lg">edit</span>
            </button>
            <button
              v-if="!s.archived"
              type="button"
              class="p-2 hover:bg-surface-container-high rounded-lg text-on-surface-variant"
              title="归档"
              @click="archiveOne(s, $event)"
            >
              <span class="material-symbols-outlined text-lg">archive</span>
            </button>
            <button
              v-else
              type="button"
              class="p-2 hover:bg-primary/10 rounded-lg text-primary"
              title="恢复"
              @click="unarchiveOne(s, $event)"
            >
              <span class="material-symbols-outlined text-lg">unarchive</span>
            </button>
            <button
              type="button"
              class="p-2 hover:bg-error-container/20 rounded-lg text-error"
              title="删除"
              @click="deleteOne(s, $event)"
            >
              <span class="material-symbols-outlined text-lg">delete</span>
            </button>
          </div>
          <span class="material-symbols-outlined text-outline-variant hidden sm:inline">chevron_right</span>
        </button>
      </div>

      <div v-if="!loading && sessions.length === 0" class="py-16 text-center text-on-surface-variant text-sm">
        暂无会话记录，或没有符合筛选条件的结果。
      </div>

      <div v-if="!loading && hasMore" class="mt-8 flex justify-center">
        <button
          type="button"
          :disabled="loadingMore"
          class="px-8 py-3 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl font-headline font-bold text-sm text-on-surface shadow-sm hover:border-primary/30 flex items-center gap-3 disabled:opacity-50"
          @click="loadMore"
        >
          {{ loadingMore ? '加载中…' : '加载更多' }}
          <span class="material-symbols-outlined text-lg">expand_more</span>
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="renameTarget"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        @click.self="closeRename"
      >
        <div class="nb-card-lg w-full max-w-md rounded-2xl p-6 space-y-4" @click.stop>
          <h3 class="font-headline font-bold text-lg">重命名会话</h3>
          <input
            v-model="renameDraft"
            type="text"
            maxlength="128"
            class="w-full rounded-xl border border-outline-variant/20 px-4 py-3 text-sm"
            @keydown.enter.prevent="commitRename"
          />
          <div class="flex justify-end gap-2">
            <button type="button" class="px-4 py-2 rounded-xl text-sm font-semibold" @click="closeRename">取消</button>
            <button type="button" class="px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-bold" @click="commitRename">
              保存
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </main>
</template>
