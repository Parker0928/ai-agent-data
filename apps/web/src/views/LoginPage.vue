<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const route = useRoute()
const router = useRouter()
const { login, loading, error } = useAuth()

const email = ref(import.meta.env.VITE_DEV_EMAIL || '')
const password = ref(import.meta.env.VITE_DEV_PASSWORD || '')

async function onSubmit() {
  const token = await login(email.value.trim(), password.value)
  if (!token) return
  const redirect = (route.query.redirect as string) || '/overview'
  await router.replace(redirect)
}
</script>

<template>
  <main class="min-h-screen flex items-center justify-center bg-background px-4">
    <section class="nb-card-lg w-full max-w-md p-6 space-y-5">
      <div>
        <h1 class="text-2xl font-black tracking-tight text-primary">登录</h1>
        <p class="text-sm text-on-surface-variant mt-1">请输入账号密码以访问系统。</p>
      </div>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <label class="block space-y-1">
          <span class="text-sm font-medium text-on-surface">邮箱</span>
          <input
            v-model="email"
            type="email"
            class="nb-input w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="dev@example.com"
            required
          />
        </label>
        <label class="block space-y-1">
          <span class="text-sm font-medium text-on-surface">密码</span>
          <input
            v-model="password"
            type="password"
            class="nb-input w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="请输入密码"
            required
          />
        </label>

        <p v-if="error" class="text-xs text-error bg-error/10 border border-error/20 rounded-lg px-3 py-2">
          {{ error }}
        </p>

        <button
          :disabled="loading"
          type="submit"
          class="nb-btn nb-btn-primary w-full py-2.5 rounded-xl font-semibold disabled:opacity-60"
        >
          {{ loading ? '登录中...' : '登录' }}
        </button>
      </form>

      <p class="text-sm text-on-surface-variant">
        还没有账号？
        <RouterLink to="/register" class="font-semibold text-primary hover:underline">去注册</RouterLink>
      </p>
    </section>
  </main>
</template>

