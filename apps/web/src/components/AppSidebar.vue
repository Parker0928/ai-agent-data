<script setup lang="ts">
import { useRoute, RouterLink, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'

defineProps<{
  mobileOpen: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const route = useRoute()
const router = useRouter()
const { logout } = useAuth()

const navItems = [
  { path: '/overview', label: '系统概览', icon: 'dashboard' },
  { path: '/chat', label: '智能对话', icon: 'forum' },
  { path: '/knowledge', label: '知识库管理', icon: 'database' },
  { path: '/market', label: '智能体市场', icon: 'storefront' },
  { path: '/history', label: '历史会话管理', icon: 'history' },
  { path: '/analysis', label: '分析详情与洞察', icon: 'monitoring' },
] as const

function onLogout() {
  logout()
  router.push('/login')
}

function onNavInteract() {
  emit('close')
}
</script>

<template>
  <aside
    id="app-sidebar-nav"
    class="flex h-dvh w-64 max-w-[min(20rem,92vw)] flex-col overflow-y-auto bg-[#f5f1ea] py-4 font-['Space_Grotesk'] text-sm font-medium text-on-surface shadow-none transition-transform duration-200 ease-out max-lg:fixed max-lg:left-0 max-lg:top-0 max-lg:z-[62] max-lg:border-r-4 max-lg:border-black max-lg:pt-[max(1rem,env(safe-area-inset-top,0px))] max-lg:pb-[env(safe-area-inset-bottom,0px)] lg:fixed lg:left-0 lg:top-0 lg:z-40 lg:border-r-4 lg:border-black"
    :class="mobileOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full'"
    aria-label="主导航"
  >
    <button
      type="button"
      class="absolute right-2 top-[max(0.75rem,env(safe-area-inset-top,0px))] z-10 flex h-10 w-10 items-center justify-center border-2 border-black bg-white text-on-surface shadow-[2px_2px_0_#141414] lg:hidden"
      aria-label="关闭导航"
      @click="emit('close')"
    >
      <span class="material-symbols-outlined text-xl" aria-hidden="true">close</span>
    </button>

    <div class="mb-2 flex items-center gap-3 px-6 py-4 pr-14 max-lg:pr-14">
      <div
        class="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-black bg-primary shadow-[3px_3px_0_#141414]"
      >
        <span
          class="material-symbols-outlined text-on-primary"
          style="font-variation-settings: 'FILL' 1"
          >dataset</span
        >
      </div>
      <div class="min-w-0">
        <h2 class="text-lg font-black uppercase leading-tight tracking-wide text-on-surface">智析 AI</h2>
        <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">数字策展</p>
      </div>
    </div>
    <nav class="flex-1 space-y-1 px-1">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="mx-2 flex items-center gap-3 border-2 border-black p-3 transition-colors duration-200"
        :class="
          route.path === item.path
            ? 'bg-tertiary text-on-tertiary shadow-[4px_4px_0_#141414]'
            : 'bg-white text-on-surface hover:bg-primary hover:text-on-primary'
        "
        @click="onNavInteract"
      >
        <span
          class="material-symbols-outlined shrink-0"
          :style="route.path === item.path ? { fontVariationSettings: `'FILL' 1` } : undefined"
        >
          {{ item.icon }}
        </span>
        <span class="min-w-0 flex-1 font-medium leading-snug">{{ item.label }}</span>
      </RouterLink>
    </nav>
    <div class="mt-auto border-t-2 border-black pt-4">
      <a
        href="#"
        class="mx-2 mb-2 flex items-center gap-3 border-2 border-black bg-white p-3 text-on-surface transition-colors hover:bg-secondary hover:text-on-secondary"
        @click="onNavInteract"
      >
        <span class="material-symbols-outlined">help</span>
        <span class="font-medium">支持中心</span>
      </a>
      <button
        type="button"
        class="mx-2 flex items-center gap-3 border-2 border-black bg-white p-3 text-on-surface transition-colors hover:bg-secondary hover:text-on-secondary"
        @click="onLogout"
      >
        <span class="material-symbols-outlined">logout</span>
        <span class="font-medium">退出登录</span>
      </button>
    </div>
  </aside>
</template>
