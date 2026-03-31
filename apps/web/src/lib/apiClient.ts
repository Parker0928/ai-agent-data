type ApiResponse<T> = T

/** Nest 全局前缀，与前端路由 /chat、/overview 等区分开 */
const API_PREFIX = '/api'

function withApiPrefix(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  if (p === API_PREFIX || p.startsWith(`${API_PREFIX}/`)) return p
  return `${API_PREFIX}${p}`
}

function isFetchNetworkError(err: unknown) {
  const msg = String((err as any)?.message || err || '').toLowerCase()
  if (msg.includes('failed to fetch') || msg.includes('networkerror')) return true
  // Safari：Load failed；部分环境：connection refused / aborted
  if (msg.includes('load failed')) return true
  if (msg.includes('network request failed')) return true
  if (msg.includes('connection refused') || msg.includes('err_connection_refused')) return true
  if (msg.includes('aborted') || msg.includes('abort')) return true
  if (err instanceof TypeError && msg.includes('fetch')) return true
  return false
}

/** 生产构建（import.meta.env.DEV=false）若仍指向 localhost，浏览器跨端口常失败；优先同源走 nginx/Vite 反代 */
function preferSameOriginApiFirst(base: string): boolean {
  if (import.meta.env.DEV) return true
  if (!base) return true
  try {
    const u = new URL(base)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

/** 当前 base 明显不是 API（网络失败、SPA 误返回 HTML、同源 4xx）时换下一候选 */
function shouldRetryNextApiBase(err: unknown, ctx?: { baseUrl?: string; status?: number }) {
  if (isFetchNetworkError(err)) return true
  const msg = String((err as any)?.message || err || '')
  if (msg.includes('接口返回了非 JSON') || msg.includes('接口返回空响应体') || msg.includes('网关/代理')) return true
  if (ctx?.baseUrl === '' && typeof ctx.status === 'number' && ctx.status >= 400) return true
  return false
}

/** 与当前页同 host 的 API 端口（局域网 IP 打开前端时，localhost:3020 往往无效） */
function samePageHostApiBases(): string[] {
  if (typeof window === 'undefined') return []
  const { protocol, hostname } = window.location
  if (!hostname) return []
  const p = protocol === 'https:' ? 'https:' : 'http:'
  return [`${p}//${hostname}:3020`, `${p}//${hostname}:3000`]
}

function getApiBaseUrlCandidates() {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined) || ''
  const base = configured.trim().replace(/\/+$/, '')

  const candidates: string[] = []
  // 先走当前站点同源，由 Vite dev proxy 或 nginx（Docker web）转发到 Nest
  if (preferSameOriginApiFirst(base)) {
    candidates.push('')
  }
  if (base) {
    candidates.push(base)
    if (/localhost:3020$|127\.0\.0\.1:3020$/.test(base)) {
      candidates.push(base.replace(':3020', ':3000'))
    }
  }
  if (base.includes('://api:')) {
    candidates.push(base.replace('://api:', '://localhost:'))
    candidates.push(base.replace('://api:', '://127.0.0.1:'))
    candidates.push(base.replace('://api:3000', '://localhost:3020'))
    candidates.push(base.replace('://api:3000', '://127.0.0.1:3020'))
  }
  // 与页面同 host 的直连（优先于纯 localhost，避免仅用 IP 访问前端时踩坑）
  candidates.push(...samePageHostApiBases())
  // 直连兜底：仅开发或未配置生产 API 基址时尝试本机端口
  if (import.meta.env.DEV || !base) {
    candidates.push('http://127.0.0.1:3020', 'http://127.0.0.1:3000', 'http://localhost:3020', 'http://localhost:3000')
  }

  const withLocalMirror = [...candidates]
  for (const c of candidates) {
    if (c.startsWith('http://localhost:')) {
      withLocalMirror.push(c.replace('http://localhost:', 'http://127.0.0.1:'))
    }
  }
  return Array.from(new Set(withLocalMirror.filter((c) => c === '' || c.length > 0)))
}

function getToken() {
  return null
}

/** 避免 res.json() 在网关返回 HTML 时抛 SyntaxError，导致整页 Vue 报错 */
async function readResponseJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error(`接口返回空响应体（HTTP ${res.status}），请检查后端是否正常。`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    const looksLikeHtml = trimmed.startsWith('<') || trimmed.startsWith('<!')
    throw new Error(
      looksLikeHtml
        ? `接口返回了非 JSON（多为网关/代理错误页），HTTP ${res.status}。请检查 API 地址与后端是否可用。`
        : `接口返回无效 JSON（HTTP ${res.status}）：${trimmed.slice(0, 160)}${trimmed.length > 160 ? '…' : ''}`,
    )
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { json?: any } = {},
): Promise<ApiResponse<T>> {
  const token = getToken()
  const baseUrls = getApiBaseUrlCandidates()
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  }

  if (token) headers.Authorization = `Bearer ${token}`

  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  let lastErr: unknown
  const pathPart = withApiPrefix(path)
  for (const baseUrl of baseUrls) {
    const base = baseUrl.replace(/\/+$/, '')
    const url = `${base}${pathPart}`
    try {
      const res = await fetch(url, {
        ...options,
        headers,
        body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
        credentials: 'include',
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const err = new Error(text || `Request failed: ${res.status}`)
        lastErr = err
        if (shouldRetryNextApiBase(err, { baseUrl, status: res.status })) continue
        throw err
      }

      try {
        return await readResponseJson<T>(res)
      } catch (e) {
        lastErr = e
        if (shouldRetryNextApiBase(e)) continue
        throw e
      }
    } catch (e) {
      lastErr = e
      if (!shouldRetryNextApiBase(e, { baseUrl })) throw e
    }
  }

  throw lastErr
}

/** multipart 上传（如知识库），与 apiFetch 使用相同的基址候选与鉴权头 */
export async function apiFormPost<T = unknown>(path: string, formData: FormData): Promise<T> {
  const token = getToken()
  const baseUrls = getApiBaseUrlCandidates()
  const pathPart = withApiPrefix(path)
  let lastErr: unknown

  for (const baseUrl of baseUrls) {
    const base = baseUrl.replace(/\/+$/, '')
    const url = `${base}${pathPart}`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
        credentials: 'include',
      })

      const text = await res.text().catch(() => '')

      if (!res.ok) {
        const err = new Error(text || `Request failed: ${res.status}`)
        lastErr = err
        if (shouldRetryNextApiBase(err, { baseUrl, status: res.status })) continue
        throw err
      }

      const trimmed = text.trim()
      if (!trimmed) return {} as T
      try {
        return JSON.parse(text) as T
      } catch {
        return {} as T
      }
    } catch (e) {
      lastErr = e
      if (!shouldRetryNextApiBase(e, { baseUrl })) throw e
    }
  }

  throw lastErr
}

export async function apiFetchStreamSSE(
  path: string,
  body: any,
  onEvent: (event: { event: string; data: any }) => void,
  options?: { signal?: AbortSignal },
) {
  const token = getToken()
  const baseUrls = getApiBaseUrlCandidates()
  const pathPart = withApiPrefix(path)

  let lastErr: unknown
  for (const baseUrl of baseUrls) {
    const base = baseUrl.replace(/\/+$/, '')
    const url = `${base}${pathPart}`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: options?.signal,
        credentials: 'include',
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Request failed: ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('SSE stream not supported')

      const decoder = new TextDecoder('utf-8')
      let buffer = ''

      const parseEventBlock = (block: string) => {
        // SSE block format:
        // event: token
        // data: {...}
        // (blank line)
        const lines = block.split('\n').map((l) => l.trimEnd())
        let eventName = 'message'
        let dataStr = ''
        for (const line of lines) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          else if (line.startsWith('data:')) dataStr += line.slice(5).trim()
        }
        let data: any = dataStr
        try {
          data = JSON.parse(dataStr)
        } catch {
          // keep string
        }
        return { event: eventName, data }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE blocks separated by double newline.
        while (buffer.includes('\n\n')) {
          const idx = buffer.indexOf('\n\n')
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          if (!block.trim()) continue
          const ev = parseEventBlock(block)
          onEvent(ev)
        }
      }
      return
    } catch (e) {
      lastErr = e
      if (!shouldRetryNextApiBase(e, { baseUrl })) throw e
    }
  }

  throw lastErr
}

