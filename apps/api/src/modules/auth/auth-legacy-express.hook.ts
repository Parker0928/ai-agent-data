import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import type { Express, NextFunction, Request, Response } from 'express'

import { AuthService } from './auth.service'
import { buildAuthCookieClearOptions, buildAuthCookieOptions } from './auth-config'

/**
 * 在 Nest 注册 404 处理之前挂上 POST /auth/login（无 /api 前缀），
 * 与 AuthController 的 POST /api/auth/login 并存；供 nginx/Vite 将 /auth/* 转到此处或直连端口使用。
 */
@Injectable()
export class AuthLegacyExpressHook implements OnModuleInit {
  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    private readonly auth: AuthService,
  ) {}

  onModuleInit() {
    const http = this.adapterHost.httpAdapter.getInstance() as Express
    const sendAuthError = (e: unknown, res: Response, next: NextFunction) => {
      if (e instanceof UnauthorizedException) {
        const err = e.getResponse()
        const body = typeof err === 'object' && err !== null ? err : { message: String(err), statusCode: 401 }
        res.status(401).json(body)
        return
      }
      if (e instanceof ConflictException) {
        const err = e.getResponse()
        const body = typeof err === 'object' && err !== null ? err : { message: String(err), statusCode: 409 }
        res.status(409).json(body)
        return
      }
      if (e instanceof BadRequestException) {
        const err = e.getResponse()
        const body = typeof err === 'object' && err !== null ? err : { message: String(err), statusCode: 400 }
        res.status(400).json(body)
        return
      }
      next(e)
    }

    http.post('/auth/login', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const email = (req.body as { email?: string })?.email
        const password = (req.body as { password?: string })?.password
        const { token, user } = await this.auth.login(String(email || ''), String(password || ''))
        res.cookie('auth_token', token, buildAuthCookieOptions())
        res.json({ user })
      } catch (e) {
        sendAuthError(e, res, next)
      }
    })

    http.post('/auth/register', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const email = (req.body as { email?: string })?.email
        const password = (req.body as { password?: string })?.password
        const { token, user } = await this.auth.register(String(email || ''), String(password || ''))
        res.cookie('auth_token', token, buildAuthCookieOptions())
        res.json({ user })
      } catch (e) {
        sendAuthError(e, res, next)
      }
    })

    http.post('/auth/logout', async (_req: Request, res: Response) => {
      res.clearCookie('auth_token', buildAuthCookieClearOptions())
      res.json({ ok: true })
    })
  }
}
