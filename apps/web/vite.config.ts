import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const webDir = path.dirname(fileURLToPath(import.meta.url))
/** Monorepo root (hoisted node_modules live here for npm workspaces). */
const monorepoRoot = path.resolve(webDir, '../..')

// Resolve via Node (same as runtime module lookup from apps/web) so Vite always
// gets a concrete file path; avoids sporadic import-analysis failures on some setups.
const require = createRequire(import.meta.url)
const dompurifyEntry = require.resolve('dompurify')

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, webDir, 'VITE_')
  // Docker Compose 注入在 process.env；须优先于 .env.development 里的 127.0.0.1:3020
  const fromEnv =
    process.env.VITE_DEV_API_PROXY?.trim() ||
    env.VITE_DEV_API_PROXY?.trim() ||
    process.env.VITE_API_BASE_URL?.trim()?.replace(/\/+$/, '') ||
    env.VITE_API_BASE_URL?.trim()?.replace(/\/+$/, '') ||
    ''
  const proxyTarget = fromEnv || 'http://127.0.0.1:3000'
  // eslint-disable-next-line no-console -- 便于确认容器内代理是否指向 api:3000
  console.log(`[vite] API proxy target: ${proxyTarget}`)

  // 只代理 /api/*；另兼容 /auth/* → /api/auth/*（旧客户端或误配 base 时仍能登录）
  const proxy: Record<string, import('vite').ProxyOptions> = {
    '/api': {
      target: proxyTarget,
      changeOrigin: true,
      timeout: 60_000,
      proxyTimeout: 60_000,
    },
    '/auth': {
      target: proxyTarget,
      changeOrigin: true,
      timeout: 60_000,
      proxyTimeout: 60_000,
      rewrite: (p) => p.replace(/^\/auth/, '/api/auth'),
    },
  }

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        dompurify: dompurifyEntry,
      },
    },
    optimizeDeps: {
      include: ['dompurify'],
    },
    server: {
      fs: {
        allow: [monorepoRoot],
      },
      proxy,
    },
  }
})
