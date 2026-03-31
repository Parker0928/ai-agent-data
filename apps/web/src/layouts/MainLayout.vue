<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppSidebar from '../components/AppSidebar.vue'
import { useAuth } from '../composables/useAuth'

const { error: authError } = useAuth()
const route = useRoute()
const mobileNavOpen = ref(false)

watch(
  () => route.fullPath,
  () => {
    mobileNavOpen.value = false
  },
)

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') mobileNavOpen.value = false
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown))
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown))
</script>

<template>
  <div class="app-layout flex min-h-dvh bg-background text-on-background">
    <div
      v-if="authError"
      class="fixed top-[max(1rem,env(safe-area-inset-top,0px))] left-1/2 -translate-x-1/2 z-[70] bg-error/10 text-error border border-error/20 rounded-xl px-4 py-3 text-sm max-w-[min(92vw,24rem)]"
      role="alert"
    >
      {{ authError }}
    </div>

    <!-- 移动端顶栏：打开侧栏；高度含 safe-area，与各页 sticky 偏移对齐 -->
    <header
      class="lg:hidden fixed top-0 left-0 right-0 z-[60] flex min-h-14 items-center gap-2 border-b-4 border-black bg-[#f5f1ea] px-3 py-2.5 pt-[max(0.5rem,env(safe-area-inset-top,0px))] pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))]"
    >
      <button
        type="button"
        class="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-black bg-white text-on-surface shadow-[2px_2px_0_#141414] transition-[transform,box-shadow] hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_#141414] active:translate-x-px active:translate-y-px active:shadow-[1px_1px_0_#141414]"
        aria-label="打开主导航"
        :aria-expanded="mobileNavOpen"
        aria-controls="app-sidebar-nav"
        @click="mobileNavOpen = true"
      >
        <span class="material-symbols-outlined text-2xl" aria-hidden="true">menu</span>
      </button>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-black uppercase tracking-wide text-on-surface">智析 AI</p>
        <p class="truncate text-[10px] font-bold text-on-surface-variant">数字策展</p>
      </div>
    </header>

    <div
      v-if="mobileNavOpen"
      class="lg:hidden fixed inset-0 z-[61] bg-black/45 backdrop-blur-[2px]"
      aria-hidden="true"
      @click="mobileNavOpen = false"
    />

    <AppSidebar :mobile-open="mobileNavOpen" @close="mobileNavOpen = false" />

    <div
      class="ml-0 flex min-h-0 min-w-0 flex-1 flex-col border-l-0 border-black pt-[calc(3.5rem+env(safe-area-inset-top,0px))] lg:ml-64 lg:border-l-4 lg:pt-0"
    >
      <RouterView />
    </div>
  </div>
</template>
