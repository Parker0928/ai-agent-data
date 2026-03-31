import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    },
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

