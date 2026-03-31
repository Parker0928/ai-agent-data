<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { apiFetch, apiFetchStreamSSE } from '../lib/apiClient'
import {
  assistantBubbleText,
  splitAssistantDisplayAndInsight,
  type KpiCard,
  type SalesRow,
  type StructuredInsight,
} from '../lib/chatStructuredOutput'
import { assistantMarkdownToHtml } from '../lib/renderAssistantMarkdown'
import { useAuth } from '../composables/useAuth'
import { useSubNav } from '../composables/useSubNav'
import { useWebSpeechRecognition } from '../composables/useWebSpeechRecognition'

type Session = {
  id: string
  title: string
  created_at: string
  updated_at: string
  /** 已归档会话仅深链注入侧栏时出现 */
  archived?: boolean
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 乐观展示用，同步服务端 id 后释放 blob */
  localPreviews?: string[]
}

type StreamAttachment = {
  kind: 'image' | 'file'
  name: string
  mimeType: string
  base64: string
}

type PendingAttachment = {
  localId: string
  kind: 'image' | 'file'
  file: File
  previewUrl?: string
}

const { subNavClass } = useSubNav()
const { loginIfNeeded } = useAuth()
const route = useRoute()
const router = useRouter()

type ChatConfig = {
  models: string[]
  defaultModel: string
  maxMessageChars: number
  embeddingsEnabled: boolean
}

const sessions = ref<Session[]>([])
const currentSessionId = ref<string | null>(null)
const messages = ref<ChatMessage[]>([])

const chatConfig = ref<ChatConfig | null>(null)
const streamAbort = ref<AbortController | null>(null)
const sessionSearch = ref('')
const sessionsPanelOpen = ref(false)
const editingSessionId = ref<string | null>(null)
const renameDraft = ref('')
const lastRagChunkCount = ref<number | null>(null)

const inputText = ref('')
const selectedModel = ref('')
const isSending = ref(false)
const composerTextareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const imageInputRef = ref<HTMLInputElement | null>(null)
const pendingAttachments = ref<PendingAttachment[]>([])
/** 附件与模型收进浮层（PC / 移动统一） */
const composerExtrasOpen = ref(false)
const composerExtrasRef = ref<HTMLElement | null>(null)

const speech = useWebSpeechRecognition()

const MAX_ATTACHMENTS = 8
const MAX_ATTACH_IMAGES = 6
const MAX_ATTACH_FILES = 4
const threadViewportRef = ref<HTMLDivElement | null>(null)
/** 随消息变高，ResizeObserver 只观察此层（视口本身高度不变时也会触发） */
const threadContentRef = ref<HTMLDivElement | null>(null)
const autoStickToBottom = ref(true)
const lastScrollTop = ref(0)
let pendingAutoScrollRaf = 0
let insightRefreshRaf = 0
let threadContentRo: ResizeObserver | null = null
let threadResizePinRaf = 0

const lastStructured = ref<StructuredInsight | null>(null)
/** 首屏加载会话/消息失败时在页内展示，避免未处理的 Promise 拒绝导致整页报错 */
const pageError = ref<string | null>(null)
const handlingMarketAgent = ref(false)

const filteredSessions = computed(() => {
  const q = sessionSearch.value.trim().toLowerCase()
  const curId = currentSessionId.value
  let list = sessions.value.filter((s) => !s.archived)
  if (curId) {
    const archivedCur = sessions.value.find((s) => s.id === curId && s.archived)
    if (archivedCur) list = [archivedCur, ...list.filter((s) => s.id !== curId)]
  }
  if (!q) return list
  return list.filter((s) => s.title.toLowerCase().includes(q))
})

const DEFAULT_FOLLOW_UPS = [
  '哪些客户分层贡献了主要增长？',
  '毛利率波动是否与渠道结构相关？',
  '从品类维度看有哪些异常点？',
]

/** 最近一条助手消息的气泡正文（已去掉结构化 JSON 块） */
const latestAssistantDisplay = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m.role !== 'assistant' || !m.content.trim()) continue
    return assistantBubbleText(m.content)
  }
  return ''
})

const displayKpis = computed<KpiCard[]>(() => lastStructured.value?.kpis ?? [])
const displayRows = computed<SalesRow[]>(() => lastStructured.value?.salesRows ?? [])
const displayFollowUps = computed(() => {
  const f = lastStructured.value?.followUps
  if (f && f.length > 0) return f
  return DEFAULT_FOLLOW_UPS
})

/** 仅来自 JSON 的摘要，不再把助手全文塞进看板（避免与气泡重复、Markdown 裸显） */
const structuredSummaryOnly = computed(() => lastStructured.value?.summary?.trim() ?? '')

/** 仅当模型返回了结构化 JSON（KPI / 表格 / 专用 summary）时才显示白色看板 */
const showStructuredPanel = computed(() => {
  const s = lastStructured.value
  if (!s) return false
  if ((s.kpis?.length ?? 0) > 0) return true
  if ((s.salesRows?.length ?? 0) > 0) return true
  if (structuredSummaryOnly.value.length > 0) return true
  return false
})

/** 已有助手正文时展示追问（与对话输出衔接，不依赖看板） */
const hasAssistantForFollowUps = computed(() => latestAssistantDisplay.value.trim().length > 0)

function assistantHtml(content: string) {
  return assistantMarkdownToHtml(assistantBubbleText(content))
}

function refreshInsightFromMessages() {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m.role !== 'assistant') continue
    const { insight } = splitAssistantDisplayAndInsight(m.content)
    lastStructured.value = insight
    return
  }
  lastStructured.value = null
}

/** 流式输出过程中若已出现代码块，节流刷新看板（JSON 闭合后解析） */
function scheduleInsightRefresh() {
  if (insightRefreshRaf) return
  insightRefreshRaf = requestAnimationFrame(() => {
    insightRefreshRaf = 0
    refreshInsightFromMessages()
  })
}

function isNearBottom(el: HTMLElement, threshold = 120) {
  return el.scrollHeight - (el.scrollTop + el.clientHeight) <= threshold
}

function onThreadScroll() {
  const el = threadViewportRef.value
  if (!el) return
  const currentTop = el.scrollTop
  const movedUp = currentTop < lastScrollTop.value - 2

  // 用户一旦上滑，立刻取消自动吸底，避免“滚不动/被拉回去”
  if (movedUp) {
    autoStickToBottom.value = false
  } else if (isNearBottom(el, 24)) {
    // 只有明确回到底部附近，才恢复自动吸底
    autoStickToBottom.value = true
  }
  lastScrollTop.value = currentTop
}

function pinThreadViewportToBottom() {
  const vp = threadViewportRef.value
  if (!vp) return
  vp.scrollTop = vp.scrollHeight
  lastScrollTop.value = vp.scrollTop
}

function detachThreadContentObserver() {
  threadContentRo?.disconnect()
  threadContentRo = null
}

/** 内容高度变化时吸底（刷新后 v-html / 字体导致的延后布局） */
function attachThreadContentObserver() {
  detachThreadContentObserver()
  const inner = threadContentRef.value
  if (!inner) return
  threadContentRo = new ResizeObserver(() => {
    if (!autoStickToBottom.value) return
    if (threadResizePinRaf) cancelAnimationFrame(threadResizePinRaf)
    threadResizePinRaf = requestAnimationFrame(() => {
      threadResizePinRaf = 0
      pinThreadViewportToBottom()
    })
  })
  threadContentRo.observe(inner)
}

async function scrollThreadToBottom(force = false) {
  await nextTick()
  if (force) await nextTick()
  const el = threadViewportRef.value
  if (!el) return
  if (!force && !autoStickToBottom.value) return

  if (pendingAutoScrollRaf) cancelAnimationFrame(pendingAutoScrollRaf)

  if (force) {
    pendingAutoScrollRaf = requestAnimationFrame(() => {
      pendingAutoScrollRaf = requestAnimationFrame(() => {
        pinThreadViewportToBottom()
        pendingAutoScrollRaf = 0
      })
    })
  } else {
    pendingAutoScrollRaf = requestAnimationFrame(() => {
      pinThreadViewportToBottom()
      pendingAutoScrollRaf = 0
    })
  }
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2)}`
}

function revokePreview(p: PendingAttachment) {
  if (p.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl)
}

function removePendingAttachment(localId: string) {
  const idx = pendingAttachments.value.findIndex((x) => x.localId === localId)
  if (idx < 0) return
  revokePreview(pendingAttachments.value[idx]!)
  pendingAttachments.value.splice(idx, 1)
}

function openImagePicker() {
  composerExtrasOpen.value = false
  imageInputRef.value?.click()
}

function openFilePicker() {
  composerExtrasOpen.value = false
  fileInputRef.value?.click()
}

function onComposerExtrasBackdrop(ev: PointerEvent) {
  if (!composerExtrasOpen.value) return
  const root = composerExtrasRef.value
  if (root?.contains(ev.target as Node)) return
  composerExtrasOpen.value = false
}

function onImageInputChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = ''
  addPendingFiles(files, 'image')
}

function onFileInputChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = ''
  addPendingFiles(files, 'file')
}

function addPendingFiles(files: File[], kind: 'image' | 'file') {
  pageError.value = null
  for (const file of files) {
    if (pendingAttachments.value.length >= MAX_ATTACHMENTS) {
      pageError.value = `最多 ${MAX_ATTACHMENTS} 个附件`
      break
    }
    if (kind === 'image') {
      if (!file.type.startsWith('image/')) continue
      const nImg = pendingAttachments.value.filter((x) => x.kind === 'image').length
      if (nImg >= MAX_ATTACH_IMAGES) {
        pageError.value = `图片最多 ${MAX_ATTACH_IMAGES} 张`
        continue
      }
      pendingAttachments.value.push({
        localId: uid('att'),
        kind: 'image',
        file,
        previewUrl: URL.createObjectURL(file),
      })
    } else {
      const nF = pendingAttachments.value.filter((x) => x.kind === 'file').length
      if (nF >= MAX_ATTACH_FILES) {
        pageError.value = `文件最多 ${MAX_ATTACH_FILES} 个`
        continue
      }
      pendingAttachments.value.push({
        localId: uid('att'),
        kind: 'file',
        file,
      })
    }
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result || '')
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

async function compressImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const maxW = 1600
      let w = img.naturalWidth
      let h = img.naturalHeight
      if (w <= maxW) {
        resolve(file)
        return
      }
      h = Math.round((h * maxW) / w)
      w = maxW
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) {
        resolve(file)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      c.toBlob(
        (blob) => {
          if (!blob) resolve(file)
          else {
            const base = file.name.replace(/\.[^.]+$/, '') || 'image'
            resolve(new File([blob], `${base}.jpg`, { type: 'image/jpeg' }))
          }
        },
        'image/jpeg',
        0.82,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })
}

async function buildStreamAttachmentsFromPending(
  pending: PendingAttachment[],
): Promise<StreamAttachment[]> {
  const out: StreamAttachment[] = []
  for (const p of pending) {
    const f = p.kind === 'image' ? await compressImageIfNeeded(p.file) : p.file
    const base64 = await fileToBase64(f)
    out.push({
      kind: p.kind,
      name: f.name,
      mimeType: f.type || 'application/octet-stream',
      base64,
    })
  }
  return out
}

function appendFromSpeech(text: string) {
  const cur = inputText.value.trim()
  inputText.value = cur ? `${cur} ${text}` : text
  nextTick(() => adjustComposerHeight())
}

function toggleSpeech() {
  speech.toggle((t) => appendFromSpeech(t))
}

async function loadChatConfig() {
  try {
    const cfg = await apiFetch<ChatConfig>('/chat/config', { method: 'GET' })
    chatConfig.value = cfg
    const models = Array.isArray(cfg.models) ? cfg.models.filter(Boolean) : []
    if (models.length === 0) {
      selectedModel.value = ''
      return
    }
    if (!selectedModel.value || !models.includes(selectedModel.value)) {
      selectedModel.value = cfg.defaultModel && models.includes(cfg.defaultModel) ? cfg.defaultModel : models[0]
    }
  } catch {
    chatConfig.value = {
      models: [],
      defaultModel: '',
      maxMessageChars: 24000,
      embeddingsEnabled: false,
    }
    selectedModel.value = ''
  }
}

async function refreshSessions() {
  const resp = await apiFetch<Session[]>('/chat/sessions', { method: 'GET' })
  sessions.value = resp
}

/** 从智能体市场「开始对话」跳转：预填欢迎语并切换推荐模型 */
async function consumeMarketAgentPreset() {
  const raw = route.query.agent
  const agentId = typeof raw === 'string' ? raw.trim() : ''
  if (!agentId) return
  if (handlingMarketAgent.value) return

  handlingMarketAgent.value = true
  try {
    // 市场「开始对话」始终新建会话，确保每次都是新的 agent 对话上下文。
    const created = await apiFetch<{ id: string }>('/chat/sessions', {
      method: 'POST',
      json: { title: '新会话' },
    })
    currentSessionId.value = created.id
    messages.value = []
    router.replace({ path: '/chat', query: { ...route.query, session: created.id } })
    await refreshSessions()
    await loadMessages(created.id)

    const fallbackHint =
      typeof route.query.agentHint === 'string' ? route.query.agentHint.trim() : ''
    const fallbackName =
      typeof route.query.agentName === 'string' ? route.query.agentName.trim() : ''
    const fallbackModel =
      typeof route.query.agentModel === 'string' ? route.query.agentModel.trim() : ''

    let agent: {
      welcomeHint?: string | null
      name?: string
      suggestedModel?: string | null
    } | null = null
    try {
      agent = await apiFetch<{
        welcomeHint?: string | null
        name?: string
        suggestedModel?: string | null
      }>(`/market/agents/${encodeURIComponent(agentId)}`, { method: 'GET' })
    } catch {
      agent = null
    }

    if (
      (agent?.suggestedModel || fallbackModel) &&
      chatConfig.value?.models?.length &&
      chatConfig.value.models.includes((agent?.suggestedModel || fallbackModel) as string)
    ) {
      selectedModel.value = (agent?.suggestedModel || fallbackModel) as string
    }

    const presetText =
      (agent?.welcomeHint || '').trim() ||
      fallbackHint ||
      ((agent?.name || fallbackName) ? `请作为「${agent?.name || fallbackName}」协助我：` : '')

    if (presetText) {
      if (isSending.value) {
        pageError.value = '当前有回复在生成中，请稍后再试。'
        inputText.value = presetText
        await nextTick()
        adjustComposerHeight()
        return
      }
      // 市场「开始对话」应直接触发一次 agent 引导会话，避免页面看起来是空白。
      await sendMessageWithContent(presetText)
      inputText.value = ''
    } else if (!inputText.value.trim()) {
      inputText.value = presetText
      await nextTick()
      adjustComposerHeight()
    }
    if (!presetText) {
      pageError.value = '未获取到智能体提示词，请返回市场页重试。'
    }
  } catch {
    pageError.value = '智能体会话初始化失败，请重试。'
  } finally {
    handlingMarketAgent.value = false
  }

  const q = { ...route.query } as Record<string, string | string[] | undefined>
  delete q.agent
  delete q.agentLaunch
  delete q.agentName
  delete q.agentHint
  delete q.agentModel
  router.replace({ path: '/chat', query: q })
}

async function ensureSession() {
  await refreshSessions()
  const qSession = typeof route.query.session === 'string' ? route.query.session : null

  if (qSession && !sessions.value.some((s) => s.id === qSession)) {
    try {
      const brief = await apiFetch<{
        id: string
        title: string
        created_at: string
        updated_at: string
        archived: boolean
      }>(`/chat/sessions/${qSession}/brief`, { method: 'GET' })
      const row: Session = {
        id: brief.id,
        title: brief.title,
        created_at: brief.created_at,
        updated_at: brief.updated_at,
        archived: brief.archived,
      }
      sessions.value = [row, ...sessions.value.filter((s) => s.id !== qSession)]
    } catch {
      /* query 中的 session 无效或无权访问 */
    }
  }

  if (sessions.value.length === 0) {
    const created = await apiFetch<{ id: string }>('/chat/sessions', {
      method: 'POST',
      json: { title: '新会话' },
    })
    currentSessionId.value = created.id
    await refreshSessions()
  } else if (qSession && sessions.value.some((s) => s.id === qSession)) {
    currentSessionId.value = qSession
  } else {
    currentSessionId.value = sessions.value.find((s) => !s.archived)?.id ?? sessions.value[0].id
  }
  if (currentSessionId.value && route.query.session !== currentSessionId.value) {
    router.replace({
      path: '/chat',
      query: { ...(route.query as Record<string, any>), session: currentSessionId.value },
    })
  }
}

async function selectSession(sessionId: string) {
  if (isSending.value) return
  if (sessionId === currentSessionId.value) {
    sessionsPanelOpen.value = false
    return
  }
  currentSessionId.value = sessionId
  router.replace({
    path: '/chat',
    query: { ...(route.query as Record<string, any>), session: sessionId },
  })
  await loadMessages(sessionId)
  sessionsPanelOpen.value = false
}

async function createNewChat() {
  if (isSending.value) return
  try {
    const created = await apiFetch<{ id: string }>('/chat/sessions', {
      method: 'POST',
      json: { title: '新会话' },
    })
    await refreshSessions()
    currentSessionId.value = created.id
    messages.value = []
    lastRagChunkCount.value = null
    lastStructured.value = null
    router.replace({
      path: '/chat',
      query: { ...(route.query as Record<string, any>), session: created.id },
    })
    sessionsPanelOpen.value = false
    await nextTick()
    attachThreadContentObserver()
  } catch (e: any) {
    pageError.value = e?.message || '创建会话失败'
  }
}

async function deleteSessionById(sessionId: string) {
  if (!confirm('确定删除该会话？将同时删除其中所有消息。')) return
  try {
    await apiFetch(`/chat/sessions/${sessionId}/delete`, { method: 'POST' })
  } catch (e: any) {
    pageError.value = e?.message || '删除会话失败'
    return
  }
  await refreshSessions()
  if (currentSessionId.value !== sessionId) return
  if (sessions.value.length > 0) {
    await selectSession(sessions.value[0].id)
  } else {
    await createNewChat()
  }
}

function beginRename(s: Session) {
  editingSessionId.value = s.id
  renameDraft.value = s.title
}

function cancelRename() {
  editingSessionId.value = null
  renameDraft.value = ''
}

async function commitRename() {
  const id = editingSessionId.value
  if (!id) return
  const t = renameDraft.value.trim()
  if (!t) {
    cancelRename()
    return
  }
  try {
    await apiFetch(`/chat/sessions/${id}`, { method: 'PATCH', json: { title: t } })
    await refreshSessions()
  } catch (e: any) {
    pageError.value = e?.message || '重命名失败'
  }
  cancelRename()
}

function stopGeneration() {
  streamAbort.value?.abort()
}

async function loadMessages(sessionId: string) {
  const resp = await apiFetch<ChatMessage[]>(
    `/chat/sessions/${sessionId}/messages`,
    { method: 'GET' },
  )
  // backend role is 'user'|'assistant'
  messages.value = resp.map((m) => ({ id: m.id, role: m.role as any, content: m.content }))
  refreshInsightFromMessages()
  autoStickToBottom.value = true
  await nextTick()
  attachThreadContentObserver()
  await scrollThreadToBottom(true)
  pinThreadViewportToBottom()
  window.setTimeout(pinThreadViewportToBottom, 50)
  window.setTimeout(pinThreadViewportToBottom, 200)
  window.setTimeout(pinThreadViewportToBottom, 500)
}

async function sendMessage() {
  const text = inputText.value.trim()
  const pending = [...pendingAttachments.value]
  if (!text && pending.length === 0) return

  inputText.value = ''
  adjustComposerHeight()
  pendingAttachments.value = []

  let attachments: StreamAttachment[] = []
  try {
    attachments = await buildStreamAttachmentsFromPending(pending)
  } catch {
    pageError.value = '附件读取失败，请重试'
    pendingAttachments.value = pending
    return
  }

  const localPreviews = pending
    .filter((p) => p.kind === 'image' && p.previewUrl)
    .map((p) => p.previewUrl!) as string[]

  await sendMessageWithContent(text, { attachments, localPreviews })
}

async function sendMessageWithContent(
  content: string,
  streamOpts?: { attachments?: StreamAttachment[]; localPreviews?: string[] },
) {
  if (isSending.value) return
  const attachments = streamOpts?.attachments ?? []
  const trimmed = content.trim()
  if (!trimmed && attachments.length === 0) return
  if (!currentSessionId.value) throw new Error('Session not ready')

  const maxLen = chatConfig.value?.maxMessageChars ?? 24000
  const approxExtra = attachments.reduce((n, a) => n + (a.base64?.length || 0), 0)
  if (trimmed.length > maxLen) {
    pageError.value = `消息过长：最多 ${maxLen} 字符（当前 ${trimmed.length}）`
    return
  }
  if (approxExtra > maxLen * 4) {
    pageError.value = '附件总体积过大，请减少图片数量或缩小文件后重试'
    return
  }

  isSending.value = true
  pageError.value = null
  const ac = new AbortController()
  streamAbort.value = ac

  const labelLines: string[] = []
  for (const a of attachments) {
    labelLines.push(a.kind === 'image' ? `[图片: ${a.name}]` : `[文件: ${a.name}]`)
  }
  const displayUser =
    trimmed && labelLines.length ? `${trimmed}\n${labelLines.join('\n')}` : trimmed || labelLines.join('\n')

  const userMsg: ChatMessage = {
    id: uid('u'),
    role: 'user',
    content: displayUser,
    localPreviews: streamOpts?.localPreviews?.length ? [...streamOpts.localPreviews] : undefined,
  }
  messages.value.push(userMsg)
  const assistantId = uid('a')
  const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '' }
  messages.value.push(assistantMsg)
  autoStickToBottom.value = true
  await scrollThreadToBottom(true)

  try {
    const modelToSend =
      selectedModel.value && chatConfig.value?.models?.includes(selectedModel.value)
        ? selectedModel.value
        : undefined
    await apiFetchStreamSSE(
      '/chat/stream',
      {
        sessionId: currentSessionId.value,
        message: trimmed || '请结合我上传的内容回答。',
        ...(modelToSend ? { model: modelToSend } : {}),
        ...(attachments.length ? { attachments } : {}),
      },
      ({ event, data }) => {
        if (event === 'meta') {
          if (data?.sessionId) {
            currentSessionId.value = data.sessionId
            router.replace({ path: '/chat', query: { session: data.sessionId } })
          }
          if (typeof data?.ragChunkCount === 'number') {
            lastRagChunkCount.value = data.ragChunkCount
          }
          if (data?.userMessageId) {
            userMsg.id = data.userMessageId
            if (userMsg.localPreviews?.length) {
              for (const u of userMsg.localPreviews) {
                if (u.startsWith('blob:')) URL.revokeObjectURL(u)
              }
              userMsg.localPreviews = undefined
            }
            const idx = messages.value.indexOf(userMsg)
            if (idx >= 0) messages.value[idx] = { ...userMsg }
          }
          void refreshSessions()
        } else if (event === 'token') {
          const token: string = data?.token ?? ''
          assistantMsg.content += token
          const idx = messages.value.findIndex((m) => m.id === assistantId)
          if (idx >= 0) messages.value[idx] = { ...assistantMsg }
          if (assistantMsg.content.includes('`')) {
            scheduleInsightRefresh()
          }
          void scrollThreadToBottom()
        } else if (event === 'done') {
          if (data?.sessionId) currentSessionId.value = data.sessionId
          if (typeof data?.chunkCount === 'number') {
            lastRagChunkCount.value = data.chunkCount
          }
          if (data?.messageId) {
            const idx = messages.value.findIndex((m) => m.id === assistantId)
            if (idx >= 0) {
              messages.value[idx] = { ...messages.value[idx], id: data.messageId }
            }
          }
          refreshInsightFromMessages()
          void scrollThreadToBottom(true)
          void refreshSessions()
        } else if (event === 'error') {
          assistantMsg.content += `\n[错误] ${data?.message || 'unknown'}`
          const idx = messages.value.findIndex((m) => m.id === assistantId)
          if (idx >= 0) messages.value[idx] = { ...assistantMsg }
          refreshInsightFromMessages()
          void scrollThreadToBottom(true)
        }
      },
      { signal: ac.signal },
    )
  } catch (e: any) {
    const aborted = e?.name === 'AbortError' || e?.message === 'The user aborted a request.'
    if (aborted) {
      for (const m of messages.value) {
        if (m.localPreviews?.length) {
          for (const u of m.localPreviews) {
            if (u.startsWith('blob:')) URL.revokeObjectURL(u)
          }
        }
      }
      if (currentSessionId.value) {
        await loadMessages(currentSessionId.value)
        refreshInsightFromMessages()
      }
    } else {
      if (userMsg.localPreviews?.length) {
        for (const u of userMsg.localPreviews) {
          if (u.startsWith('blob:')) URL.revokeObjectURL(u)
        }
        userMsg.localPreviews = undefined
      }
      const msg = e?.message || '流式请求失败'
      assistantMsg.content += `\n[错误] ${msg}`
      const idx = messages.value.findIndex((m) => m.id === assistantId)
      if (idx >= 0) messages.value[idx] = { ...assistantMsg }
      refreshInsightFromMessages()
      await scrollThreadToBottom(true)
    }
  } finally {
    streamAbort.value = null
    isSending.value = false
  }
}

function adjustComposerHeight() {
  const el = composerTextareaRef.value
  if (!el) return
  el.style.height = 'auto'
  const maxHeight = 220
  const next = Math.min(el.scrollHeight, maxHeight)
  el.style.height = `${next}px`
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

function onComposerInput() {
  adjustComposerHeight()
}

function trendClass(trend: SalesRow['trend']) {
  if (trend === '上涨') return 'text-emerald-600'
  if (trend === '下降') return 'text-rose-500'
  return 'text-emerald-600'
}

async function sendFollowUp(text: string) {
  if (isSending.value) return
  await sendMessageWithContent(text)
}

function exportSalesCsv() {
  const rows = displayRows.value
  if (rows.length === 0) return
  const header = ['省份/地区', '销售额（k）', '对比率', '趋势']
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [r.region, r.amount, r.ratio, r.trend].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
    ),
  ]
  const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `sales-breakdown-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function onComposerKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void sendMessage()
  }
}

watch(selectedModel, () => {
  composerExtrasOpen.value = false
})

watch(
  () => route.query.session,
  async (q) => {
    if (typeof q !== 'string' || !q) return
    if (q === currentSessionId.value) return
    if (isSending.value) return
    await refreshSessions()
    if (!sessions.value.some((s) => s.id === q)) return
    currentSessionId.value = q
    await loadMessages(q)
  },
)

watch(
  () => route.query.agent,
  async (agent) => {
    if (typeof agent !== 'string' || !agent.trim()) return
    if (!currentSessionId.value) return
    await consumeMarketAgentPreset()
  },
)

watch(
  () => route.query.agentLaunch,
  async (launch) => {
    if (typeof launch !== 'string' || !launch.trim()) return
    if (typeof route.query.agent !== 'string' || !route.query.agent.trim()) return
    if (!currentSessionId.value) return
    await consumeMarketAgentPreset()
  },
)

onMounted(async () => {
  document.addEventListener('pointerdown', onComposerExtrasBackdrop, true)
  pageError.value = null
  try {
    const token = await loginIfNeeded()
    if (!token) {
      pageError.value =
        '未登录：请先在登录页登录，或在开发环境配置 VITE_DEV_EMAIL / VITE_DEV_PASSWORD。'
      return
    }
    await loadChatConfig()
    await ensureSession()
    if (currentSessionId.value) await loadMessages(currentSessionId.value)
    else await nextTick()
    await consumeMarketAgentPreset()
    if (!threadContentRo && threadContentRef.value) attachThreadContentObserver()
    adjustComposerHeight()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    pageError.value = msg || '加载智能对话失败'
    console.error('[ChatPage] mount failed', e)
  }
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onComposerExtrasBackdrop, true)
  detachThreadContentObserver()
  if (threadResizePinRaf) cancelAnimationFrame(threadResizePinRaf)
  speech.stop()
  for (const p of pendingAttachments.value) revokePreview(p)
})
</script>

<template>
  <main
    data-page-route="/chat"
    class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden relative bg-transparent text-on-background"
  >
    <header
      class="fixed top-[calc(3.5rem+env(safe-area-inset-top,0px))] left-0 right-0 z-40 bg-background border-b-4 border-black flex items-center justify-between px-3 sm:px-8 py-3 sm:py-4 shadow-xl gap-2 sm:gap-6 lg:top-0 lg:left-64"
    >
      <div class="flex items-center gap-3 sm:gap-8 min-w-0 shrink" data-section-path="chat.header-nav">
        <button
          type="button"
          class="lg:hidden shrink-0 rounded-full p-2 hover:bg-white/50 transition-colors"
          aria-label="打开会话列表"
          @click="sessionsPanelOpen = true"
        >
          <span class="material-symbols-outlined text-on-surface-variant">menu</span>
        </button>
        <h1 class="text-lg sm:text-xl font-black tracking-tighter text-primary font-headline shrink-0 truncate">
          智能对话
        </h1>
        <nav class="hidden md:flex gap-6 shrink-0" aria-label="本页子模块">
          <RouterLink
            :to="{ path: '/chat', hash: '#chat-thread' }"
            :class="subNavClass('#chat-thread', true)"
            >会话内容</RouterLink
          >
          <RouterLink
            :to="{ path: '/chat', hash: '#chat-composer' }"
            :class="subNavClass('#chat-composer')"
            >输入区域</RouterLink
          >
        </nav>
      </div>
      <div class="flex items-center gap-1.5 sm:gap-2 flex-1 justify-end min-w-0">
        <span
          v-if="lastRagChunkCount != null && lastRagChunkCount > 0"
          class="nb-pill nb-pill-tertiary hidden sm:inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
          title="本轮已注入知识库片段"
        >
          <span class="material-symbols-outlined text-sm">library_books</span>
          RAG {{ lastRagChunkCount }}
        </span>
        <span
          v-else-if="chatConfig && !chatConfig.embeddingsEnabled"
          class="nb-pill hidden lg:inline text-[10px] font-semibold text-on-surface px-2 py-1 rounded-full bg-white"
          >向量检索关闭</span
        >
        <RouterLink
          to="/history"
          class="hover:bg-white/50 rounded-full p-2 transition-all flex items-center justify-center"
          aria-label="历史会话管理"
        >
          <span class="material-symbols-outlined text-on-surface-variant">history</span>
        </RouterLink>
        <div class="h-8 w-px bg-outline-variant/30 mx-1 hidden sm:block" />
        <div class="hidden sm:flex items-center gap-2 pl-1">
          <span class="text-xs sm:text-sm font-semibold font-headline text-primary whitespace-nowrap"
            >助理模式</span
          >
          <div
            class="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center shrink-0"
          >
            <span
              class="material-symbols-outlined text-primary text-lg"
              style="font-variation-settings: 'FILL' 1"
              >auto_awesome</span
            >
          </div>
        </div>
      </div>
    </header>

    <div
      v-if="sessionsPanelOpen"
      class="lg:hidden fixed inset-0 z-30 bg-black/25"
      aria-hidden="true"
      @click="sessionsPanelOpen = false"
    />

    <!-- 大屏：会话列表 fixed，不随中间消息区滚动；小屏仍为抽屉 -->
    <aside
      :class="[
        'flex flex-col w-72 border-r-4 border-black bg-[#f5f1ea] overflow-hidden',
        sessionsPanelOpen
          ? 'max-lg:fixed max-lg:left-0 max-lg:top-[calc(3.5rem+5.5rem+env(safe-area-inset-top,0px))] max-lg:bottom-0 max-lg:z-40 max-lg:shadow-2xl max-lg:flex'
          : 'max-lg:hidden',
        'lg:fixed lg:left-64 lg:top-[88px] lg:bottom-0 lg:z-20 lg:flex',
      ]"
    >
        <div class="p-3 border-b-2 border-black flex items-center gap-2">
          <button
            type="button"
            class="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary text-on-primary py-2.5 text-xs font-bold hover:shadow-md transition-shadow"
            @click="createNewChat"
          >
            <span class="material-symbols-outlined text-lg">add_comment</span>
            新会话
          </button>
          <button
            type="button"
            class="lg:hidden rounded-xl p-2.5 hover:bg-white/60 text-on-surface-variant"
            aria-label="关闭会话列表"
            @click="sessionsPanelOpen = false"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="p-2 border-b-2 border-black">
          <div class="relative">
            <span
              class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg pointer-events-none"
              >search</span
            >
            <input
              v-model="sessionSearch"
              type="search"
              class="nb-input w-full rounded-xl py-2 pl-10 pr-3 text-xs focus:ring-2 focus:ring-primary/20"
              placeholder="搜索会话标题…"
              autocomplete="off"
            />
          </div>
        </div>
        <div
          class="session-list-scroll flex-1 min-h-0 overflow-y-auto px-2.5 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] space-y-2"
        >
          <div
            v-for="s in filteredSessions"
            :key="s.id"
            class="rounded-lg border-2 transition-[box-shadow,transform,background-color,border-color] duration-150 ease-out"
            :class="
              s.id === currentSessionId
                ? 'border-black bg-white shadow-[4px_4px_0_#141414] -translate-y-px ring-1 ring-primary/15'
                : 'border-black/12 bg-white/50 backdrop-blur-[2px] hover:border-black/40 hover:bg-white/95 hover:shadow-[3px_3px_0_rgba(20,20,20,0.18)]'
            "
          >
            <div
              class="px-3.5 py-3 flex items-start gap-2.5 min-h-[4.25rem]"
              :class="s.id === currentSessionId ? 'bg-[linear-gradient(120deg,rgba(31,94,255,0.09)_0%,transparent_42%)]' : ''"
            >
              <button
                type="button"
                class="flex-1 min-w-0 text-left rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                @click="selectSession(s.id)"
              >
                <template v-if="editingSessionId === s.id">
                  <input
                    v-model="renameDraft"
                    class="session-rename-input w-full text-xs font-bold px-2.5 py-2 bg-white rounded-md"
                    @keydown.enter.prevent="commitRename"
                    @keydown.esc.prevent="cancelRename"
                    @click.stop
                  />
                </template>
                <template v-else>
                  <p
                    class="text-[13px] font-black text-on-surface tracking-tight leading-snug flex items-center gap-2 min-w-0 font-headline"
                  >
                    <span
                      class="material-symbols-outlined text-primary shrink-0 text-[18px] opacity-90"
                      aria-hidden="true"
                      >chat_bubble</span
                    >
                    <span class="truncate min-w-0">{{ s.title }}</span>
                    <span
                      v-if="s.archived"
                      class="shrink-0 border-2 border-black px-1 py-px text-[9px] font-black uppercase tracking-wide bg-surface-container-low text-on-surface-variant rounded-sm"
                      >已归档</span
                    >
                  </p>
                  <p
                    class="mt-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-on-surface-variant/90 tabular-nums tracking-wide"
                  >
                    <span class="material-symbols-outlined text-[13px] opacity-70 shrink-0" aria-hidden="true"
                      >schedule</span
                    >
                    <span class="line-clamp-1">更新 {{ new Date(s.updated_at).toLocaleString() }}</span>
                  </p>
                </template>
              </button>
              <div
                v-if="editingSessionId !== s.id"
                class="flex flex-row gap-1 shrink-0 self-center"
              >
                <button
                  type="button"
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 border-black/12 bg-white text-on-surface-variant shadow-[2px_2px_0_rgba(20,20,20,0.08)] transition-[transform,box-shadow,color,background-color] hover:border-primary/40 hover:text-primary hover:shadow-[3px_3px_0_rgba(31,94,255,0.25)] hover:-translate-y-px active:translate-y-px active:shadow-[1px_1px_0_rgba(20,20,20,0.12)]"
                  title="重命名"
                  @click.stop="beginRename(s)"
                >
                  <span class="material-symbols-outlined text-[18px] leading-none">edit</span>
                </button>
                <button
                  type="button"
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 border-black/12 bg-white text-error/90 shadow-[2px_2px_0_rgba(20,20,20,0.08)] transition-[transform,box-shadow,color,background-color] hover:border-error/50 hover:bg-error/[0.06] hover:shadow-[3px_3px_0_rgba(220,38,38,0.2)] hover:-translate-y-px active:translate-y-px active:shadow-[1px_1px_0_rgba(20,20,20,0.12)]"
                  title="删除"
                  @click.stop="deleteSessionById(s.id)"
                >
                  <span class="material-symbols-outlined text-[18px] leading-none">delete</span>
                </button>
              </div>
              <div v-else class="flex flex-col gap-1.5 shrink-0 self-center">
                <button
                  type="button"
                  class="min-h-8 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wide bg-primary text-on-primary"
                  @click.stop="commitRename"
                >
                  保存
                </button>
                <button
                  type="button"
                  class="min-h-8 px-2.5 py-1.5 text-[10px] font-bold bg-white text-on-surface"
                  @click.stop="cancelRename"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
          <p
            v-if="filteredSessions.length === 0"
            class="text-xs font-medium text-on-surface-variant/85 text-center py-10 px-3 leading-relaxed rounded-lg border-2 border-dashed border-black/15 bg-white/40"
          >
            没有匹配的会话
          </p>
        </div>
    </aside>

    <div
      class="relative z-0 flex min-h-0 min-w-0 w-full flex-1 pt-[calc(3.5rem+5.5rem+env(safe-area-inset-top,0px))] lg:pt-[88px] lg:pl-72"
    >
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <section
          id="chat-thread"
          class="scroll-mt-28 flex min-h-0 min-w-0 flex-1 flex-col px-4 sm:px-6 pb-2 max-w-5xl mx-auto w-full"
        >
      <div
        v-if="pageError"
        class="mb-4 rounded-2xl border border-error/25 bg-error/10 px-4 py-3 text-sm text-error"
        role="alert"
      >
        {{ pageError }}
      </div>
      <div
        ref="threadViewportRef"
        class="thread-viewport flex-1 min-h-0 min-w-0 touch-pan-y overflow-auto overscroll-y-contain no-scrollbar pb-[calc(24rem+env(safe-area-inset-bottom,0px))] sm:pb-[calc(26rem+env(safe-area-inset-bottom,0px))] [overflow-anchor:none]"
        @scroll="onThreadScroll"
      >
        <div ref="threadContentRef" class="space-y-6">
        <div
          v-for="m in messages"
          :key="m.id"
          :class="
            m.role === 'user'
              ? 'flex flex-col items-end'
              : 'flex flex-col items-start'
          "
        >
          <div
            :class="
              m.role === 'user'
                ? 'max-w-[80%] bg-tertiary/25 text-on-surface px-6 py-4 rounded-3xl rounded-tr-none nb-card break-words'
                : 'max-w-[min(100%,52rem)] w-full bg-white text-on-surface px-6 py-4 rounded-3xl nb-card break-words'
            "
          >
            <p
              v-if="m.role === 'assistant' && !m.content.trim() && isSending && messages[messages.length - 1]?.id === m.id"
              class="leading-relaxed text-[0.9375rem] text-outline-variant flex items-center gap-2"
            >
              <span class="inline-flex gap-1" aria-hidden="true">
                <span class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style="animation-delay: 0ms" />
                <span class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style="animation-delay: 150ms" />
                <span class="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style="animation-delay: 300ms" />
              </span>
              <span>正在生成回答…</span>
            </p>
            <div
              v-else-if="m.role === 'assistant'"
              class="chat-md text-[0.9375rem] leading-relaxed text-on-surface min-w-0"
              v-html="assistantHtml(m.content)"
            />
            <div v-else class="space-y-2 min-w-0">
              <div
                v-if="m.localPreviews?.length"
                class="flex flex-wrap gap-2 justify-end"
              >
                <img
                  v-for="(src, i) in m.localPreviews"
                  :key="i"
                  :src="src"
                  alt=""
                  class="max-h-36 max-w-[min(100%,14rem)] rounded-xl object-cover border border-white/40 shadow-sm"
                />
              </div>
              <p class="leading-relaxed whitespace-pre-wrap text-[0.9375rem]">
                {{ m.content }}
              </p>
            </div>
          </div>
        </div>

        <div
          v-if="showStructuredPanel"
          class="rounded-3xl bg-white border border-surface-container shadow-sm p-6 space-y-5"
        >
          <div class="flex items-center gap-2 text-xs text-outline">
            <span class="material-symbols-outlined text-primary text-base">dataset</span>
            <span>本轮回答中的结构化指标（由模型 JSON 输出驱动）</span>
          </div>

          <div
            v-if="structuredSummaryOnly"
            class="rounded-2xl bg-surface-container-low p-4 text-on-surface"
          >
            <p class="text-xs font-semibold text-primary mb-2">结构化摘要</p>
            <div class="chat-md text-[0.9375rem] leading-relaxed" v-html="assistantMarkdownToHtml(structuredSummaryOnly)" />
          </div>

          <div v-if="displayKpis.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              v-for="card in displayKpis"
              :key="card.label"
              class="rounded-2xl border border-surface-container bg-surface-container-low p-4 space-y-3"
            >
              <div class="flex items-center justify-between">
                <p class="text-xs text-outline">{{ card.label }}</p>
                <span
                  class="material-symbols-outlined text-sm"
                  :class="card.positive ? 'text-indigo-500' : 'text-rose-500'"
                >
                  {{ card.positive ? 'trending_up' : 'trending_down' }}
                </span>
              </div>
              <div class="flex items-end gap-2">
                <p class="text-3xl font-bold tracking-tight text-on-surface">{{ card.value }}</p>
                <p class="text-xs mb-1" :class="card.positive ? 'text-emerald-600' : 'text-rose-500'">
                  {{ card.delta }}
                </p>
              </div>
              <div class="h-1.5 rounded-full bg-surface-container-high">
                <div
                  class="h-full rounded-full"
                  :class="card.positive ? 'bg-indigo-500 w-[74%]' : 'bg-rose-500 w-[45%]'"
                ></div>
              </div>
            </div>
          </div>

          <div v-if="displayRows.length > 0" class="rounded-2xl border border-surface-container bg-surface p-4">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-semibold text-on-surface">省级销售额分布</h3>
              <button
                type="button"
                class="text-xs text-indigo-500 font-semibold hover:underline"
                @click="exportSalesCsv"
              >
                导出 CSV
              </button>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-sm min-w-[560px]">
                <thead>
                  <tr class="text-left text-outline border-b border-surface-container">
                    <th class="py-2 font-medium">省份/地区</th>
                    <th class="py-2 font-medium">销售额（k）</th>
                    <th class="py-2 font-medium">对比率</th>
                    <th class="py-2 font-medium">趋势</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in displayRows"
                    :key="row.region"
                    class="border-b border-surface-container-low last:border-b-0"
                  >
                    <td class="py-2.5 text-on-surface">{{ row.region }}</td>
                    <td class="py-2.5 text-on-surface">{{ row.amount }}</td>
                    <td class="py-2.5 text-outline">{{ row.ratio }}</td>
                    <td class="py-2.5 font-medium" :class="trendClass(row.trend)">{{ row.trend }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div v-if="hasAssistantForFollowUps" class="flex flex-wrap gap-2 pt-1">
          <button
            v-for="item in displayFollowUps"
            :key="item"
            type="button"
            class="text-xs px-3 py-2 rounded-full bg-[#f2ecff] text-primary hover:bg-[#e9defe] transition-colors disabled:opacity-50"
            :disabled="isSending"
            @click="sendFollowUp(item)"
          >
            {{ item }}
          </button>
        </div>
        </div>
      </div>
    </section>
      </div>
    </div>
    <div
      class="pointer-events-none fixed bottom-0 left-0 right-0 z-[38] flex flex-col items-stretch bg-gradient-to-t from-background from-40% via-background/95 to-transparent pt-12 pb-[max(2rem,calc(0.75rem+env(safe-area-inset-bottom,0px)))] px-3 sm:px-8 sm:pt-16 lg:left-[calc(16rem+18rem)]"
    >
      <div
        id="chat-composer"
        class="scroll-mt-32 pointer-events-auto max-w-4xl mx-auto w-full"
      >
        <input
          ref="imageInputRef"
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          @change="onImageInputChange"
        />
        <input
          ref="fileInputRef"
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.html,.htm,image/*"
          class="hidden"
          @change="onFileInputChange"
        />
        <div
          v-if="pendingAttachments.length"
          class="flex flex-wrap gap-2 mb-2 px-1"
        >
          <div
            v-for="p in pendingAttachments"
            :key="p.localId"
            class="group relative flex items-center gap-2 pl-2 pr-7 py-1.5 rounded-2xl bg-surface-container-low border border-outline-variant/15 text-xs max-w-[min(100%,220px)]"
          >
            <img
              v-if="p.kind === 'image' && p.previewUrl"
              :src="p.previewUrl"
              alt=""
              class="w-9 h-9 rounded-lg object-cover shrink-0"
            />
            <span v-else class="material-symbols-outlined text-primary text-lg shrink-0">draft</span>
            <span class="truncate font-medium text-on-surface">{{ p.file.name }}</span>
            <button
              type="button"
              class="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-black/5 text-outline"
              aria-label="移除附件"
              @click="removePendingAttachment(p.localId)"
            >
              <span class="material-symbols-outlined text-base">close</span>
            </button>
          </div>
        </div>
        <p
          v-if="speech.interim"
          class="text-[11px] text-primary/80 px-3 mb-1 truncate"
          aria-live="polite"
        >
          识别中：{{ speech.interim }}
        </p>
        <p v-if="speech.error" class="text-[11px] text-error px-3 mb-1">{{ speech.error }}</p>
        <div
          class="nb-card rounded-[2.5rem] p-2 focus-within:ring-4 focus-within:ring-primary/5 transition-all"
        >
          <div
            class="flex min-h-[3.25rem] flex-nowrap items-end gap-1.5 px-2 py-2 sm:gap-2 sm:px-4"
          >
            <!-- 附件 + 模型统一收入浮层（PC / 移动相同交互） -->
            <div ref="composerExtrasRef" class="relative shrink-0 self-end">
              <button
                type="button"
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-black bg-white text-on-surface shadow-[2px_2px_0_#141414] transition-[transform,box-shadow] hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_#141414] active:translate-x-px active:translate-y-px active:shadow-[1px_1px_0_#141414] disabled:opacity-45 sm:h-11 sm:w-11"
                title="附件、图片与对话模型"
                :disabled="isSending"
                :aria-expanded="composerExtrasOpen"
                aria-haspopup="dialog"
                aria-controls="composer-extras-panel"
                @click.stop="composerExtrasOpen = !composerExtrasOpen"
              >
                <span class="material-symbols-outlined text-[22px] sm:text-[24px]" aria-hidden="true">tune</span>
              </button>
              <div
                v-show="composerExtrasOpen"
                id="composer-extras-panel"
                role="dialog"
                aria-label="附件与模型"
                class="absolute bottom-[calc(100%+0.5rem)] left-0 z-[80] w-[min(18rem,calc(100vw-1.75rem))] rounded-2xl border-2 border-black bg-background p-3 shadow-[6px_6px_0_#141414] lg:w-72"
                @click.stop
              >
                <p class="mb-2.5 text-[10px] font-black uppercase tracking-wider text-outline">附件与模型</p>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    class="flex items-center justify-center gap-1.5 border-2 border-black bg-white px-2 py-2.5 text-xs font-bold shadow-[2px_2px_0_#141414] transition-transform hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_#141414] active:translate-x-px active:shadow-[1px_1px_0_#141414] disabled:opacity-45"
                    :disabled="isSending"
                    @click="openFilePicker"
                  >
                    <span class="material-symbols-outlined text-[18px]" aria-hidden="true">attach_file</span>
                    文件
                  </button>
                  <button
                    type="button"
                    class="flex items-center justify-center gap-1.5 border-2 border-black bg-white px-2 py-2.5 text-xs font-bold shadow-[2px_2px_0_#141414] transition-transform hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_#141414] active:translate-x-px active:shadow-[1px_1px_0_#141414] disabled:opacity-45"
                    :disabled="isSending"
                    @click="openImagePicker"
                  >
                    <span class="material-symbols-outlined text-[18px]" aria-hidden="true">image</span>
                    图片
                  </button>
                </div>
                <div class="relative mt-3 border-t-2 border-black/15 pt-3">
                  <label for="chat-model-select" class="mb-1.5 block text-[10px] font-bold text-on-surface-variant">对话模型</label>
                  <div class="relative">
                    <select
                      id="chat-model-select"
                      v-model="selectedModel"
                      title="对话模型"
                      class="composer-model-select w-full min-w-0 max-w-none py-2 pl-3 pr-9 text-on-surface text-xs font-semibold sm:text-[13px]"
                    >
                      <option
                        v-for="m in chatConfig?.models || []"
                        :key="m"
                        :value="m"
                        class="bg-white text-on-surface font-medium normal-case"
                      >
                        {{ m }}
                      </option>
                    </select>
                    <span
                      class="pointer-events-none absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 bg-surface-container-low text-on-surface"
                      aria-hidden="true"
                    >
                      <span class="material-symbols-outlined text-[16px] leading-none sm:text-[18px]">expand_more</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <textarea
              ref="composerTextareaRef"
              v-model="inputText"
              @input="onComposerInput"
              @keydown="onComposerKeydown"
              class="flex-1 min-w-0 min-h-[2.5rem] max-h-[220px] appearance-none border-0 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 shadow-none ring-0 text-[0.9375rem] py-2 sm:py-2.5 leading-snug resize-none bg-transparent placeholder:text-outline/40"
              placeholder="向智能助手提问，例如 '分析本季度的毛利构成'..."
              rows="1"
            ></textarea>
            <div class="flex items-center gap-0.5 shrink-0">
              <button
                v-if="isSending"
                type="button"
                class="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-error/10 text-error border border-error/20 flex items-center justify-center hover:bg-error/15 transition-all"
                title="停止生成"
                @click="stopGeneration"
              >
                <span class="material-symbols-outlined text-[22px] sm:text-[24px]">stop_circle</span>
              </button>
              <button
                type="button"
                class="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all"
                :class="
                  speech.listening
                    ? 'bg-primary text-white shadow-md shadow-primary/25 animate-pulse'
                    : 'hover:bg-surface-container-low text-outline-variant hover:text-primary'
                "
                :title="
                  speech.supported
                    ? speech.listening
                      ? '点击停止语音输入'
                      : '语音输入（中文）'
                    : '浏览器不支持语音识别'
                "
                :disabled="isSending || !speech.supported"
                @click="toggleSpeech"
              >
                <span class="material-symbols-outlined text-[22px] sm:text-[24px]">mic</span>
              </button>
              <button
                type="button"
                :disabled="isSending"
                @click="sendMessage"
                class="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-primary text-white shadow-lg shadow-primary/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
              >
                <span class="material-symbols-outlined text-[22px] sm:text-[24px]">arrow_upward</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div
      class="absolute -top-24 -right-24 w-96 h-96 bg-primary/5 rounded-full blur-[120px] -z-10"
    ></div>
    <div class="absolute top-1/2 -left-24 w-64 h-64 bg-tertiary/5 rounded-full blur-[100px] -z-10"></div>
  </main>
</template>

<style scoped>
.chat-md :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  margin: 0.5rem 0;
}
.chat-md :deep(th),
.chat-md :deep(td) {
  border: 1px solid rgb(226 232 240);
  padding: 0.35rem 0.5rem;
  text-align: left;
  vertical-align: top;
}
.chat-md :deep(th) {
  background: rgb(248 250 252);
  font-weight: 600;
}
.chat-md :deep(h1),
.chat-md :deep(h2),
.chat-md :deep(h3) {
  font-weight: 700;
  margin: 0.65rem 0 0.35rem;
  line-height: 1.35;
}
.chat-md :deep(h2) {
  font-size: 1.05rem;
}
.chat-md :deep(h3) {
  font-size: 1rem;
}
.chat-md :deep(ul),
.chat-md :deep(ol) {
  margin: 0.35rem 0 0.35rem 1.1rem;
}
.chat-md :deep(li) {
  margin: 0.15rem 0;
}
.chat-md :deep(hr) {
  margin: 0.6rem 0;
  border: 0;
  border-top: 1px solid rgb(226 232 240);
}
.chat-md :deep(a) {
  color: rgb(79 70 229);
  text-decoration: underline;
}
.chat-md :deep(pre) {
  overflow-x: auto;
  padding: 0.5rem;
  border-radius: 0.5rem;
  background: rgb(248 250 252);
  font-size: 0.8rem;
}
.chat-md :deep(code) {
  font-size: 0.85em;
}

/* 会话列表：细滚动条 + 稳定 gutter，避免与 Neo-brutalist 侧栏冲突 */
.session-list-scroll {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(20, 20, 20, 0.38) rgba(245, 241, 234, 0.4);
}
.session-list-scroll::-webkit-scrollbar {
  width: 6px;
}
.session-list-scroll::-webkit-scrollbar-track {
  margin: 4px 0;
  background: rgba(20, 20, 20, 0.05);
  border-radius: 4px;
}
.session-list-scroll::-webkit-scrollbar-thumb {
  background: rgba(20, 20, 20, 0.32);
  border-radius: 4px;
  border: 1px solid rgba(245, 241, 234, 0.6);
}
.session-list-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(31, 94, 255, 0.45);
}
</style>
