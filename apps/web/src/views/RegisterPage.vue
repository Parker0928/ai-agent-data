<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { register, loading, error } = useAuth()

const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const localError = ref<string | null>(null)

const canSubmit = computed(
  () =>
    email.value.trim().length > 0 &&
    password.value.length >= 8 &&
    passwordConfirm.value.length >= 8 &&
    !loading.value,
)

async function onSubmit() {
  localError.value = null
  if (password.value !== passwordConfirm.value) {
    localError.value = '两次输入的密码不一致'
    return
  }
  const token = await register(email.value.trim(), password.value)
  if (!token) return
  await router.replace('/overview')
}
</script>

<template>
  <main class="min-h-screen flex items-center justify-center bg-background px-4">
    <section class="nb-card-lg w-full max-w-md p-6 space-y-5">
      <div>
        <h1 class="text-2xl font-black tracking-tight text-primary">注册</h1>
        <p class="text-sm text-on-surface-variant mt-1">创建新账号后将自动登录并进入系统。</p>
      </div>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <label class="block space-y-1">
          <span class="text-sm font-medium text-on-surface">邮箱</span>
          <input
            v-model="email"
            type="email"
            class="nb-input w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="you@example.com"
            required
          />
        </label>
        <label class="block space-y-1">
          <span class="text-sm font-medium text-on-surface">密码</span>
          <input
            v-model="password"
            type="password"
            class="nb-input w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="至少 8 位"
            minlength="8"
            required
          />
        </label>
        <label class="block space-y-1">
          <span class="text-sm font-medium text-on-surface">确认密码</span>
          <input
            v-model="passwordConfirm"
            type="password"
            class="nb-input w-full rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="再次输入密码"
            minlength="8"
            required
          />
        </label>

        <p v-if="localError" class="text-xs text-error bg-error/10 border border-error/20 rounded-lg px-3 py-2">
          {{ localError }}
        </p>
        <p v-else-if="error" class="text-xs text-error bg-error/10 border border-error/20 rounded-lg px-3 py-2">
          {{ error }}
        </p>

        <button
          :disabled="!canSubmit"
          type="submit"
          class="nb-btn nb-btn-primary w-full py-2.5 rounded-xl font-semibold disabled:opacity-60"
        >
          {{ loading ? '注册中...' : '注册并登录' }}
        </button>
      </form>

      <p class="text-sm text-on-surface-variant">
        已有账号？
        <RouterLink to="/login" class="font-semibold text-primary hover:underline">去登录</RouterLink>
      </p>
    </section>
  </main>
</template>
