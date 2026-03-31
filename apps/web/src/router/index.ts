import { h } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'
import { useAuth } from '../composables/useAuth'

const NotFoundPage = {
  name: 'NotFoundPage',
  setup() {
    const path = window.location.pathname
    return () => h('div', { class: 'p-8 text-center text-sm text-on-surface-variant' }, `404: ${path}`)
  },
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    meta: { title: '登录', public: true },
    component: () => import('../views/LoginPage.vue'),
  },
  {
    path: '/register',
    name: 'Register',
    meta: { title: '注册', public: true },
    component: () => import('../views/RegisterPage.vue'),
  },
  {
    path: '/',
    component: MainLayout,
    redirect: '/overview',
    meta: { requiresAuth: true },
    children: [
      {
        path: 'history',
        name: 'History',
        meta: { title: '历史会话管理' },
        component: () => import('../views/HistoryPage.vue'),
      },
      {
        path: 'analysis',
        name: 'Analysis',
        meta: { title: '分析详情与洞察' },
        component: () => import('../views/AnalysisPage.vue'),
      },
      {
        path: 'chat',
        name: 'Chat',
        meta: { title: '智能对话' },
        component: () => import('../views/ChatPage.vue'),
      },
      {
        path: 'overview',
        name: 'Overview',
        meta: { title: '系统概览' },
        component: () => import('../views/OverviewPage.vue'),
      },
      {
        path: 'knowledge',
        name: 'Knowledge',
        meta: { title: '知识库管理' },
        component: () => import('../views/KnowledgePage.vue'),
      },
      {
        path: 'market',
        name: 'Market',
        meta: { title: '智能体市场' },
        component: () => import('../views/MarketPage.vue'),
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: NotFoundPage,
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    // 智能对话：由 ChatPage 内线程容器滚到最新，避免 hash 把窗口滚到 #chat-thread 顶部
    if (to.name === 'Chat') {
      return { left: 0, top: 0 }
    }
    if (to.hash) {
      return { el: to.hash, behavior: 'smooth', top: 72 }
    }
    return { top: 0 }
  },
})

router.beforeEach(async (to, _from, next) => {
  const { isAuthenticated, fetchMe } = useAuth()
  const isPublic = Boolean(to.meta.public)
  const requiresAuth = Boolean(to.meta.requiresAuth)

  if (!isPublic && (requiresAuth || to.path !== '/login')) {
    const me = isAuthenticated() ? true : Boolean(await fetchMe())
    if (!me) {
      next({ path: '/login', query: { redirect: to.fullPath } })
      return
    }
    next()
    return
  }

  if (to.path === '/login' || to.path === '/register') {
    const me = isAuthenticated() ? true : Boolean(await fetchMe())
    if (me) {
      next('/overview')
      return
    }
  }

  next()
})
