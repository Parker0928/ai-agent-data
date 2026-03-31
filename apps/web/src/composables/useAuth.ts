import { ref } from 'vue'
import { apiFetch } from '../lib/apiClient'

type LoginResp = {
  token: string
  user: { id: string; email: string }
}

// Make auth state shared across all components that call `useAuth()`.
const loading = ref(false)
const error = ref<string | null>(null)
const user = ref<{ id: string; email: string } | null>(null)

function getToken() {
  return localStorage.getItem('jwt_token')
}

function humanizeLoginError(raw: string): string {
  const s = String(raw || '').trim()
  if (/failed to fetch|networkerror|load failed/i.test(s)) {
    return '无法连接后端：请确认 API 与数据库已启动；本地开发时 Postgres 需监听 5432，API 多为 http://localhost:3000（或 .env 中的 VITE_API_BASE_URL）。'
  }
  try {
    const j = JSON.parse(s) as { message?: string | string[] }
    const m = j.message
    if (Array.isArray(m)) return m.filter(Boolean).join('；')
    if (typeof m === 'string') return m
  } catch {
    /* 非 JSON 则原样展示短文本 */
  }
  return s.length > 280 ? `${s.slice(0, 280)}…` : s || '登录失败'
}

function humanizeRegisterError(raw: string): string {
  const s = String(raw || '').trim()
  if (/failed to fetch|networkerror|load failed/i.test(s)) {
    return '无法连接后端：请确认 API 服务已启动。'
  }
  try {
    const j = JSON.parse(s) as { message?: string | string[] }
    const m = j.message
    if (Array.isArray(m)) return m.filter(Boolean).join('；')
    if (typeof m === 'string') return m
  } catch {
    /* ignore */
  }
  return s.length > 280 ? `${s.slice(0, 280)}…` : s || '注册失败'
}

export function useAuth() {
  async function login(email: string, password: string): Promise<string | null> {
    loading.value = true
    error.value = null
    try {
      const resp = await apiFetch<LoginResp>('/auth/login', {
        method: 'POST',
        json: { email, password },
      })
      localStorage.setItem('jwt_token', resp.token)
      user.value = resp.user
      return resp.token
    } catch (e: any) {
      localStorage.removeItem('jwt_token')
      error.value = humanizeLoginError(e?.message || 'Login failed')
      return null
    } finally {
      loading.value = false
    }
  }

  async function register(email: string, password: string): Promise<string | null> {
    loading.value = true
    error.value = null
    try {
      const resp = await apiFetch<LoginResp>('/auth/register', {
        method: 'POST',
        json: { email, password },
      })
      localStorage.setItem('jwt_token', resp.token)
      user.value = resp.user
      return resp.token
    } catch (e: any) {
      localStorage.removeItem('jwt_token')
      error.value = humanizeRegisterError(e?.message || 'Register failed')
      return null
    } finally {
      loading.value = false
    }
  }

  async function loginIfNeeded(): Promise<string | null> {
    const existing = getToken()
    if (existing) return existing

    const email = import.meta.env.VITE_DEV_EMAIL as string | undefined
    const password = import.meta.env.VITE_DEV_PASSWORD as string | undefined
    if (!email || !password) {
      error.value = 'Missing VITE_DEV_EMAIL/VITE_DEV_PASSWORD for auto-login'
      return null
    }

    return login(email, password)
  }

  async function fetchMe() {
    const existing = getToken()
    if (!existing) {
      user.value = null
      return null
    }
    try {
      const resp = await apiFetch<{ user: { id: string; email: string } }>('/auth/me', { method: 'GET' })
      user.value = resp.user
      return resp.user
    } catch {
      localStorage.removeItem('jwt_token')
      user.value = null
      return null
    }
  }

  function logout() {
    localStorage.removeItem('jwt_token')
    user.value = null
  }

  return {
    loading,
    error,
    user,
    isAuthenticated: () => Boolean(getToken()),
    loginIfNeeded,
    login,
    register,
    fetchMe,
    logout,
  }
}

