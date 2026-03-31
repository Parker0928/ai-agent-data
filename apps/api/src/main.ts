import 'reflect-metadata'
import type { NextFunction, Request, Response } from 'express'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'

function parseCorsOrigins() {
  const configured = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  if (configured.length > 0) return configured
  if ((process.env.NODE_ENV || 'development') !== 'production') {
    return ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8080']
  }
  return []
}

async function bootstrap() {
  const corsOrigins = parseCorsOrigins()
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    cors: {
      origin: corsOrigins.length > 0 ? corsOrigins : false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
  })

  app.use((req: Request & { cookies?: Record<string, string> }, _res: Response, next: NextFunction) => {
    const raw = String(req?.headers?.cookie || '')
    const cookies: Record<string, string> = {}
    for (const item of raw.split(';')) {
      const [k, ...rest] = item.trim().split('=')
      if (!k) continue
      cookies[k] = decodeURIComponent(rest.join('=') || '')
    }
    req.cookies = cookies
    next()
  })

  // 先挂全局前缀，再配 body，避免部分环境下路由与解析顺序异常
  app.setGlobalPrefix('api')

  // 聊天流式接口可携带 base64 图片/文件附件
  app.useBodyParser('json', { limit: '18mb' })
  app.useBodyParser('urlencoded', { extended: true, limit: '18mb' })

  app.enableShutdownHooks()

  const port = Number(process.env.PORT || 3000)
  await app.listen(port)
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${port}`)
}

bootstrap()

