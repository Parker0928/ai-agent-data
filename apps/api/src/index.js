import 'dotenv/config'
import express from 'express'
import cors from 'cors'

const app = express()
const port = Number(process.env.PORT || 3000)
const appEnv = process.env.APP_ENV || process.env.NODE_ENV || 'development'

app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({
    service: 'api',
    status: 'ok',
    env: appEnv,
    timestamp: new Date().toISOString(),
  })
})

app.get('/api/version', (_req, res) => {
  res.json({
    name: '@apps/api',
    version: '0.1.0',
    env: appEnv,
  })
})

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port} (${appEnv})`)
})
