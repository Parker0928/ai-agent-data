<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { apiFetch, apiFormPost } from '../lib/apiClient'
import { useAuth } from '../composables/useAuth'
import { useSubNav } from '../composables/useSubNav'

type DocRow = {
  id: string
  filename: string
  sourceUrl: string | null
  sourceType: string
  status: string
  statusKey: 'indexed' | 'parsed' | 'empty'
  chunkCount: number
  embeddedChunkCount: number
  createdAt: string
  dimension: number
  sizeText: string
  textChars?: number
}

type KnowledgeStats = {
  documents: number
  fromUrl: number
  fromFile: number
  chunks: number
  embeddedChunks: number
  vectorDimensions: number
  embeddingsEnvEnabled: boolean
}

type ChunkItem = {
  id: string
  chunkIndex: number
  content: string
  metadata: Record<string, unknown>
  embedded: boolean
}

const STRATEGY_LABELS = {
  semantic: '语义化自动切分 (推荐)',
  fixed: '固定字符数 (512 词元)',
  paragraph: '按段落强制切分',
} as const

const LABEL_TO_STRATEGY: Record<string, keyof typeof STRATEGY_LABELS> = {
  '语义化自动切分 (推荐)': 'semantic',
  '固定字符数 (512 词元)': 'fixed',
  '按段落强制切分': 'paragraph',
}

const { subNavClass } = useSubNav()
const { loginIfNeeded, user, fetchMe } = useAuth()

const fileInputRef = ref<HTMLInputElement | null>(null)

const ragTopK = ref(5)
const similarityThreshold = ref(0.82)
const chunkStrategyLabel = ref<string>(STRATEGY_LABELS.semantic)

const docs = ref<DocRow[]>([])
const stats = ref<KnowledgeStats | null>(null)
const listLoading = ref(false)
const statsLoading = ref(false)
const savingConfig = ref(false)
const uploading = ref(false)

const docSearch = ref('')
let searchDebounce: ReturnType<typeof setTimeout> | null = null

const ingestError = ref<string | null>(null)
const successToast = ref<string | null>(null)

const showUrlPanel = ref(false)
const urlToIngest = ref('')

const previewOpen = ref(false)
const previewDoc = ref<DocRow | null>(null)
const previewLoading = ref(false)
const previewChunks = ref<ChunkItem[]>([])
const previewTotal = ref(0)
const previewOffset = ref(0)
const previewLimit = 25

const totalChunks = computed(() => stats.value?.chunks ?? docs.value.reduce((a, d) => a + d.chunkCount, 0))

const chunkSizeAndOverlap = computed(() => {
  const key = LABEL_TO_STRATEGY[chunkStrategyLabel.value] || 'semantic'
  if (key === 'fixed') return { chunkSize: 512, chunkOverlap: 64 }
  if (key === 'paragraph') return { chunkSize: 800, chunkOverlap: 0 }
  return { chunkSize: 800, chunkOverlap: 120 }
})

function strategyKeyFromLabel(label: string): keyof typeof STRATEGY_LABELS {
  return LABEL_TO_STRATEGY[label] || 'semantic'
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
  return s.length > 400 ? `${s.slice(0, 400)}…` : s || '请求失败'
}

function flashToast(msg: string) {
  successToast.value = msg
  window.setTimeout(() => {
    successToast.value = null
  }, 3200)
}

async function loadStats() {
  statsLoading.value = true
  try {
    stats.value = await apiFetch<KnowledgeStats>('/knowledge/stats', { method: 'GET' })
  } catch {
    stats.value = null
  } finally {
    statsLoading.value = false
  }
}

async function loadConfig() {
  const cfg = await apiFetch<{
    topK?: number
    similarityThreshold?: number
    chunkStrategy?: string
  }>('/knowledge/config', { method: 'GET' })
  if (typeof cfg?.topK === 'number') ragTopK.value = cfg.topK
  if (typeof cfg?.similarityThreshold === 'number') similarityThreshold.value = cfg.similarityThreshold
  const key = (cfg?.chunkStrategy || 'semantic').toLowerCase()
  if (key in STRATEGY_LABELS) {
    chunkStrategyLabel.value = STRATEGY_LABELS[key as keyof typeof STRATEGY_LABELS]
  }
}

async function loadDocs() {
  listLoading.value = true
  ingestError.value = null
  try {
    const q = docSearch.value.trim()
    const path = q ? `/knowledge/docs?q=${encodeURIComponent(q)}` : '/knowledge/docs'
    docs.value = await apiFetch<DocRow[]>(path, { method: 'GET' })
  } catch (e: any) {
    ingestError.value = parseApiError(String(e?.message || e))
    docs.value = []
  } finally {
    listLoading.value = false
  }
}

watch(docSearch, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    loadDocs()
  }, 380)
})

async function saveConfig() {
  savingConfig.value = true
  ingestError.value = null
  try {
    const { chunkSize, chunkOverlap } = chunkSizeAndOverlap.value
    await apiFetch('/knowledge/config', {
      method: 'PUT',
      json: {
        topK: ragTopK.value,
        similarityThreshold: similarityThreshold.value,
        chunkSize,
        chunkOverlap,
        chunkStrategy: strategyKeyFromLabel(chunkStrategyLabel.value),
      },
    })
    await loadConfig()
    flashToast('RAG 配置已保存（新上传的文档将使用当前分块参数）')
  } catch (e: any) {
    ingestError.value = parseApiError(String(e?.message || e))
  } finally {
    savingConfig.value = false
  }
}

function openFileDialog() {
  fileInputRef.value?.click()
}

async function ingestFile(file: File) {
  ingestError.value = null
  uploading.value = true
  const fd = new FormData()
  fd.append('file', file)
  try {
    await apiFormPost('/knowledge/upload', fd)
    flashToast(`已导入「${file.name}」`)
    await Promise.all([loadDocs(), loadStats()])
  } catch (e: any) {
    ingestError.value = `上传失败：${parseApiError(String(e?.message || e))}`
  } finally {
    uploading.value = false
  }
}

async function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await ingestFile(file)
  if (fileInputRef.value) fileInputRef.value.value = ''
}

async function submitUrlIngest() {
  const url = urlToIngest.value.trim()
  if (!url) {
    ingestError.value = '请输入有效的 URL'
    return
  }
  ingestError.value = null
  uploading.value = true
  const fd = new FormData()
  fd.append('url', url)
  try {
    await apiFormPost('/knowledge/upload', fd)
    flashToast('网页内容已导入知识库')
    urlToIngest.value = ''
    showUrlPanel.value = false
    await Promise.all([loadDocs(), loadStats()])
  } catch (e: any) {
    ingestError.value = `URL 导入失败：${parseApiError(String(e?.message || e))}`
  } finally {
    uploading.value = false
  }
}

async function deleteDoc(doc: DocRow) {
  const ok = window.confirm(`确定删除「${doc.filename}」及其全部分块？此操作不可恢复。`)
  if (!ok) return
  ingestError.value = null
  try {
    await apiFetch(`/knowledge/docs/${doc.id}`, { method: 'DELETE' })
    if (previewDoc.value?.id === doc.id) closePreview()
    flashToast('已删除文档')
    await Promise.all([loadDocs(), loadStats()])
  } catch (e: any) {
    ingestError.value = parseApiError(String(e?.message || e))
  }
}

async function openPreview(doc: DocRow) {
  previewDoc.value = doc
  previewOpen.value = true
  previewOffset.value = 0
  previewChunks.value = []
  await loadMorePreviewChunks(true)
}

function closePreview() {
  previewOpen.value = false
  previewDoc.value = null
  previewChunks.value = []
}

async function loadMorePreviewChunks(reset = false) {
  if (!previewDoc.value) return
  if (reset) previewOffset.value = 0
  previewLoading.value = true
  try {
    const res = await apiFetch<{
      total: number
      items: ChunkItem[]
      limit: number
      offset: number
    }>(
      `/knowledge/docs/${previewDoc.value.id}/chunks?limit=${previewLimit}&offset=${previewOffset.value}`,
      { method: 'GET' },
    )
    previewTotal.value = res.total
    if (reset) previewChunks.value = res.items
    else previewChunks.value = [...previewChunks.value, ...res.items]
  } catch (e: any) {
    ingestError.value = parseApiError(String(e?.message || e))
  } finally {
    previewLoading.value = false
  }
}

async function loadNextPreviewPage() {
  if (!previewDoc.value || previewLoading.value) return
  if (previewChunks.value.length >= previewTotal.value) return
  previewOffset.value += previewLimit
  await loadMorePreviewChunks(false)
}

function statusBadgeClass(key: DocRow['statusKey']) {
  if (key === 'indexed') return 'bg-emerald-100 text-emerald-800'
  if (key === 'parsed') return 'bg-amber-100 text-amber-900'
  return 'bg-surface-container-high text-on-surface-variant'
}

onMounted(async () => {
  const token = await loginIfNeeded()
  if (!token) return
  if (!user.value) await fetchMe()
  await loadConfig()
  await Promise.all([loadDocs(), loadStats()])
})
</script>

<template>
  <main data-page-route="/knowledge" class="min-h-screen bg-background text-on-background">
    <header
      class="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-40 flex w-full items-center justify-between gap-3 border-b-4 border-black bg-background px-4 py-3 shadow-xl sm:gap-6 sm:px-6 sm:py-4 lg:top-0 lg:px-8"
    >
      <div class="flex items-center gap-8 min-w-0 shrink" data-section-path="knowledge.header-nav">
        <h1 class="shrink-0 text-lg font-black tracking-tighter text-primary font-headline sm:text-xl">知识库</h1>
        <nav class="hidden md:flex gap-6 shrink-0" aria-label="本页子模块">
          <RouterLink
            :to="{ path: '/knowledge', hash: '#knowledge-rag' }"
            :class="subNavClass('#knowledge-rag', true)"
            >RAG 配置</RouterLink
          >
          <RouterLink
            :to="{ path: '/knowledge', hash: '#knowledge-docs' }"
            :class="subNavClass('#knowledge-docs')"
            >文档与索引</RouterLink
          >
        </nav>
      </div>
      <div class="flex items-center gap-4 flex-1 justify-end min-w-0">
        <div class="relative w-full max-w-xl group hidden sm:block">
          <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline"
            >search</span
          >
          <input
            v-model="docSearch"
            class="nb-input w-full py-2.5 pl-12 pr-4 text-sm focus:ring-2 focus:ring-primary/20 transition-all"
            placeholder="按文件名或 URL 搜索文档…"
            type="search"
            autocomplete="off"
          />
        </div>
        <div class="h-8 w-[1px] bg-outline-variant/30 mx-1 hidden sm:block"></div>
        <div class="flex items-center gap-3 min-w-0">
          <div class="hidden lg:block text-right truncate max-w-[200px]">
            <p class="text-sm font-bold text-on-surface truncate">{{ user?.email || '已登录' }}</p>
            <p class="text-[10px] text-outline">知识库</p>
          </div>
          <div class="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold shrink-0">
            {{ (user?.email || '?').slice(0, 1).toUpperCase() }}
          </div>
        </div>
      </div>
    </header>

    <div class="mx-auto max-w-7xl space-y-6 p-4 pb-24 sm:space-y-8 sm:p-6 lg:p-8">
      <div
        v-if="successToast"
        class="bg-primary/10 text-primary border border-primary/20 rounded-lg px-4 py-3 text-sm font-medium"
        role="status"
      >
        {{ successToast }}
      </div>
      <div
        v-if="ingestError"
        class="bg-error/10 text-error border border-error/20 rounded-lg px-4 py-3 text-sm"
        role="alert"
      >
        {{ ingestError }}
      </div>

      <section class="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 class="text-4xl font-headline font-extrabold tracking-tight text-on-surface">知识库管理</h2>
          <p class="text-on-surface-variant mt-2 max-w-xl">
            上传文档或抓取网页，自动分块入库；开启向量化后可在对话中 RAG 检索。支持预览分块、搜索与删除。
          </p>
        </div>
        <div class="flex flex-col sm:flex-row gap-3 sm:items-start">
          <input
            ref="fileInputRef"
            type="file"
            class="hidden"
            accept=".pdf,.docx,.txt,.md,.html,.htm,.png,.jpg,.jpeg,.webp"
            :disabled="uploading"
            @change="handleFileChange"
          />
          <button
            type="button"
            :disabled="uploading"
            class="bg-primary text-on-primary px-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50"
            @click="openFileDialog"
          >
            <span class="material-symbols-outlined text-xl">{{
              uploading ? 'hourglass_empty' : 'upload'
            }}</span>
            {{ uploading ? '处理中…' : '上传文档' }}
          </button>
          <button
            type="button"
            class="nb-btn nb-btn-secondary px-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-all"
            @click="showUrlPanel = !showUrlPanel"
          >
            <span class="material-symbols-outlined text-xl">language</span>
            抓取 URL
          </button>
        </div>
      </section>

      <div
        v-if="showUrlPanel"
        class="nb-card flex flex-col sm:flex-row gap-3 p-4 rounded-xl"
      >
        <input
          v-model="urlToIngest"
          type="url"
          class="flex-1 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/25"
          placeholder="https://example.com/page"
          @keyup.enter="submitUrlIngest"
        />
        <button
          type="button"
          :disabled="uploading"
          class="px-6 py-2.5 rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
          @click="submitUrlIngest"
        >
          开始导入
        </button>
      </div>

      <div class="grid grid-cols-12 gap-6">
        <div id="knowledge-rag" class="scroll-mt-28 col-span-12 lg:col-span-4 space-y-6">
          <div class="nb-card p-6 rounded-xl space-y-6">
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-headline font-bold text-on-surface">RAG 核心配置</h3>
              <span class="material-symbols-outlined text-primary">settings_suggest</span>
            </div>
            <div class="space-y-4">
              <div class="space-y-2">
                <div class="flex justify-between text-sm">
                  <label class="font-medium text-on-surface-variant">Top-k（检索条数）</label>
                  <span class="text-primary font-bold">{{ ragTopK }}</span>
                </div>
                <input
                  v-model.number="ragTopK"
                  :min="1"
                  :max="20"
                  step="1"
                  class="nb-range w-full"
                  type="range"
                />
              </div>
              <div class="space-y-2">
                <div class="flex justify-between text-sm">
                  <label class="font-medium text-on-surface-variant">相似度阈值</label>
                  <span class="text-primary font-bold">{{ similarityThreshold.toFixed(2) }}</span>
                </div>
                <input
                  v-model.number="similarityThreshold"
                  :min="0.5"
                  :max="0.95"
                  step="0.01"
                  class="nb-range w-full"
                  type="range"
                />
                <p class="text-[11px] text-outline">阈值越低召回越多，可能引入弱相关片段。</p>
              </div>
              <div class="space-y-2">
                <label class="text-sm font-medium text-on-surface-variant">分块策略</label>
                <select
                  v-model="chunkStrategyLabel"
                  class="w-full bg-surface-container-lowest border border-outline-variant/15 rounded-lg text-sm p-3 focus:ring-2 focus:ring-primary/20"
                >
                  <option>{{ STRATEGY_LABELS.semantic }}</option>
                  <option>{{ STRATEGY_LABELS.fixed }}</option>
                  <option>{{ STRATEGY_LABELS.paragraph }}</option>
                </select>
                <p class="text-[11px] text-outline">
                  对应块大小约 {{ chunkSizeAndOverlap.chunkSize }} / 重叠
                  {{ chunkSizeAndOverlap.chunkOverlap }}（保存时写入服务端）
                </p>
              </div>
            </div>
            <button
              type="button"
              :disabled="savingConfig"
              class="w-full py-3 border-2 border-primary/20 text-primary font-bold rounded-lg hover:bg-primary/5 transition-colors disabled:opacity-50"
              @click="saveConfig"
            >
              {{ savingConfig ? '保存中…' : '保存全局配置' }}
            </button>
          </div>

          <div
            class="relative overflow-hidden border-2 border-black bg-gradient-to-br from-primary via-[#2f5ae0] to-[#0d1f4d] p-6 text-white shadow-[8px_8px_0_#141414]"
          >
            <div
              class="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-tertiary/35 blur-2xl"
              aria-hidden="true"
            />
            <div
              class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-white/5"
              aria-hidden="true"
            />
            <div class="relative z-[1]">
              <div class="mb-5 flex items-start justify-between gap-3">
                <div class="flex items-center gap-3">
                  <div
                    class="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-white/35 bg-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                  >
                    <span class="material-symbols-outlined text-[26px] text-white" aria-hidden="true"
                      >memory</span
                    >
                  </div>
                  <div>
                    <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">Knowledge index</p>
                    <h3 class="font-headline text-base font-black tracking-tight text-white">索引概览</h3>
                  </div>
                </div>
                <span
                  class="shrink-0 border border-white/25 bg-black/15 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-white/90"
                  >RAG</span
                >
              </div>
              <div v-if="statsLoading" class="py-2 text-sm font-medium text-white/85">加载统计…</div>
              <template v-else-if="stats">
                <div class="mb-1 font-headline text-4xl font-black tabular-nums tracking-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.35)]">
                  {{ totalChunks.toLocaleString() }}
                </div>
                <p class="mb-5 text-xs font-semibold text-white/75">文本分块总数</p>
                <div class="grid grid-cols-2 gap-3">
                  <div
                    class="border border-white/20 bg-white/10 px-3 py-3 backdrop-blur-[6px]"
                  >
                    <p class="text-[10px] font-bold uppercase tracking-wide text-white/65">已向量化</p>
                    <p class="mt-1 font-headline text-2xl font-black tabular-nums text-white">
                      {{ stats.embeddedChunks.toLocaleString() }}
                    </p>
                  </div>
                  <div
                    class="border border-white/20 bg-white/10 px-3 py-3 backdrop-blur-[6px]"
                  >
                    <p class="text-[10px] font-bold uppercase tracking-wide text-white/65">文档数</p>
                    <p class="mt-1 font-headline text-2xl font-black tabular-nums text-white">
                      {{ stats.documents.toLocaleString() }}
                    </p>
                  </div>
                </div>
                <div
                  class="mt-4 border border-white/15 bg-black/25 px-3 py-2.5 text-[11px] leading-snug text-white/90 backdrop-blur-sm"
                >
                  <span class="font-semibold text-tertiary">向量维度 {{ stats.vectorDimensions }}</span>
                  <span class="text-white/50"> · </span>
                  <span v-if="stats.embeddingsEnvEnabled">
                    服务端已开启向量化（ENABLE_EMBEDDINGS），新导入会写入 embedding。
                  </span>
                  <span v-else>
                    当前未开启向量化：分块仍会保存，对话 RAG 需在后端设置 ENABLE_EMBEDDINGS=true。
                  </span>
                </div>
              </template>
              <p v-else class="py-1 text-sm font-medium text-white/80">暂无统计数据</p>
            </div>
          </div>
        </div>

        <div
          id="knowledge-docs"
          class="scroll-mt-28 col-span-12 lg:col-span-8 nb-card-lg rounded-xl overflow-hidden relative"
        >
          <div
            class="p-6 border-b border-surface-container-low flex flex-wrap items-center justify-between gap-3"
          >
            <h3 class="text-lg font-headline font-bold text-on-surface">文档与向量化状态</h3>
            <div class="flex flex-wrap gap-2">
              <span
                class="bg-secondary-container/30 text-secondary text-[10px] px-2 py-1 rounded-full font-bold"
                >文件 {{ stats?.fromFile ?? '—' }}</span
              >
              <span
                class="bg-tertiary-container/30 text-tertiary text-[10px] px-2 py-1 rounded-full font-bold"
                >网页 {{ stats?.fromUrl ?? '—' }}</span
              >
              <button
                type="button"
                class="text-[10px] px-2 py-1 rounded-full border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-low transition-colors"
                :disabled="listLoading"
                @click="loadDocs(); loadStats()"
              >
                刷新
              </button>
            </div>
          </div>

          <div class="sm:hidden px-4 py-3 border-b border-surface-container-low">
            <input
              v-model="docSearch"
              type="search"
              class="w-full rounded-lg bg-surface-container-low px-3 py-2 text-sm"
              placeholder="搜索文档…"
            />
          </div>

          <div v-if="listLoading && docs.length === 0" class="p-12 text-center text-on-surface-variant text-sm">
            加载文档列表…
          </div>
          <div
            v-else-if="docs.length === 0"
            class="p-12 text-center text-on-surface-variant text-sm space-y-2"
          >
            <p class="material-symbols-outlined text-4xl text-outline mb-2">folder_open</p>
            <p>暂无文档。上传文件或导入 URL 开始构建知识库。</p>
            <p v-if="docSearch.trim()" class="text-xs">没有匹配「{{ docSearch }}」的条目，试试其它关键词。</p>
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full text-left text-sm min-w-[640px]">
              <thead>
                <tr
                  class="text-outline uppercase text-[10px] font-bold tracking-widest border-b border-surface-container-low"
                >
                  <th class="px-6 py-4">文件名 / 源</th>
                  <th class="px-6 py-4">类型</th>
                  <th class="px-6 py-4">状态</th>
                  <th class="px-6 py-4">向量</th>
                  <th class="px-6 py-4">大小</th>
                  <th class="px-6 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-surface-container-low">
                <tr
                  v-for="doc in docs"
                  :key="doc.id"
                  class="group hover:bg-surface-container-low/50 transition-colors"
                >
                  <td class="px-6 py-4">
                    <div class="flex items-center gap-3 min-w-0">
                      <div
                        class="w-10 h-10 rounded bg-surface-container-lowest flex items-center justify-center text-on-surface-variant shrink-0"
                      >
                        <span
                          class="material-symbols-outlined"
                          :class="
                            doc.filename.toLowerCase().endsWith('.pdf') ? 'text-red-600' : 'text-blue-600'
                          "
                        >
                          {{
                            doc.filename.toLowerCase().endsWith('.pdf')
                              ? 'picture_as_pdf'
                              : doc.sourceUrl
                                ? 'link'
                                : 'description'
                          }}
                        </span>
                      </div>
                      <div class="min-w-0">
                        <p class="font-bold text-on-surface truncate" :title="doc.filename">{{ doc.filename }}</p>
                        <p class="text-[11px] text-outline truncate" :title="doc.sourceUrl || ''">
                          {{ new Date(doc.createdAt).toLocaleString() }}
                          <template v-if="doc.sourceUrl"> · {{ doc.sourceUrl }}</template>
                        </p>
                      </div>
                    </div>
                  </td>
                  <td class="px-6 py-4 text-on-surface-variant whitespace-nowrap">
                    {{ doc.sourceType === 'url' ? '网页' : '文件' }}
                  </td>
                  <td class="px-6 py-4">
                    <span
                      class="inline-flex items-center gap-1.5 py-1 px-3 rounded-full text-[11px] font-bold"
                      :class="statusBadgeClass(doc.statusKey)"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-current opacity-70"></span>
                      {{ doc.status }}
                    </span>
                  </td>
                  <td class="px-6 py-4 font-mono text-outline whitespace-nowrap">
                    {{ doc.dimension > 0 ? `${doc.dimension}d` : '—' }}
                    <span class="block text-[10px] text-on-surface-variant font-sans"
                      >{{ doc.embeddedChunkCount }}/{{ doc.chunkCount }} 已向量化</span
                    >
                  </td>
                  <td class="px-6 py-4 text-on-surface-variant whitespace-nowrap">{{ doc.sizeText }}</td>
                  <td class="px-6 py-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      class="p-2 rounded-lg text-primary hover:bg-primary/10 text-sm font-semibold"
                      @click="openPreview(doc)"
                    >
                      分块
                    </button>
                    <button
                      type="button"
                      class="p-2 rounded-lg text-error hover:bg-error/10 text-sm font-semibold ml-1"
                      @click="deleteDoc(doc)"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <section class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="nb-card rounded-xl p-5">
          <div class="flex items-center justify-between mb-4">
            <div
              class="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center"
            >
              <span class="material-symbols-outlined text-base">hub</span>
            </div>
            <span class="text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary font-bold">对话 RAG</span>
          </div>
          <h4 class="text-sm font-bold text-on-surface">检索与阈值</h4>
          <p class="text-[11px] text-on-surface-variant mt-2 leading-relaxed">
            Top-k 与相似度阈值在左侧配置；聊天流式接口会自动按用户隔离检索
            <code class="text-[10px] bg-surface-container-high px-1 rounded">document_chunks</code>。
          </p>
        </div>
        <div class="nb-card rounded-xl p-5">
          <div class="flex items-center justify-between mb-4">
            <div
              class="w-8 h-8 rounded-full bg-secondary/10 text-secondary flex items-center justify-center"
            >
              <span class="material-symbols-outlined text-base">splitscreen</span>
            </div>
            <span class="text-[10px] px-2 py-1 rounded-full bg-secondary/10 text-secondary font-bold"
              >分块入库</span
            >
          </div>
          <h4 class="text-sm font-bold text-on-surface">文本始终落库</h4>
          <p class="text-[11px] text-on-surface-variant mt-2 leading-relaxed">
            即使未开向量化，也会保存分块便于预览与管理；开启向量化后同表写入
            embedding 供相似度检索。
          </p>
        </div>
        <div class="nb-card rounded-xl p-5">
          <div class="flex items-center justify-between mb-4">
            <div
              class="w-8 h-8 rounded-full bg-tertiary/10 text-tertiary flex items-center justify-center"
            >
              <span class="material-symbols-outlined text-base">shield_lock</span>
            </div>
            <span class="text-[10px] px-2 py-1 rounded-full bg-surface-container-high text-outline font-bold"
              >隔离</span
            >
          </div>
          <h4 class="text-sm font-bold text-on-surface">按用户隔离</h4>
          <p class="text-[11px] text-on-surface-variant mt-2 leading-relaxed">
            列表、统计、删除与分块预览均校验 JWT 用户，仅可操作本人数据。
          </p>
        </div>
      </section>
    </div>

    <!-- 分块预览抽屉 -->
    <Teleport to="body">
      <div
        v-if="previewOpen"
        class="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-label="文档分块预览"
        @click.self="closePreview"
      >
        <div
          class="w-full max-w-lg h-full nb-card-lg flex flex-col border-l-4 border-black"
          @click.stop
        >
          <div class="p-4 border-b border-surface-container-low flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h4 class="font-headline font-bold text-on-surface truncate">{{ previewDoc?.filename }}</h4>
              <p class="text-[11px] text-outline mt-1">
                共 {{ previewTotal }} 条分块 · 已加载 {{ previewChunks.length }}
              </p>
            </div>
            <button
              type="button"
              class="p-2 rounded-full hover:bg-surface-container-low text-on-surface-variant"
              aria-label="关闭"
              @click="closePreview"
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-4 space-y-3">
            <div v-if="previewLoading && previewChunks.length === 0" class="text-sm text-on-surface-variant py-8 text-center">
              加载分块…
            </div>
            <article
              v-for="c in previewChunks"
              :key="c.id"
              class="rounded-xl border border-outline-variant/15 bg-surface-container-low p-3 text-sm"
            >
              <div class="flex items-center justify-between gap-2 mb-2">
                <span class="text-[10px] font-bold text-primary uppercase tracking-wider"
                  >#{{ c.chunkIndex }}</span
                >
                <span
                  class="text-[10px] px-2 py-0.5 rounded-full font-bold"
                  :class="c.embedded ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'"
                >
                  {{ c.embedded ? '已向量化' : '仅文本' }}
                </span>
              </div>
              <p class="text-on-surface leading-relaxed whitespace-pre-wrap break-words text-[13px]">
                {{ c.content }}
              </p>
            </article>
            <div v-if="previewChunks.length < previewTotal" class="pt-2 pb-6 text-center">
              <button
                type="button"
                :disabled="previewLoading"
                class="text-sm font-semibold text-primary hover:underline disabled:opacity-50"
                @click="loadNextPreviewPage"
              >
                {{ previewLoading ? '加载中…' : '加载更多' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </main>
</template>
