import { Body, Controller, Get, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common'
import type { Response } from 'express'
import { Res } from '@nestjs/common'
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './jwt-auth.guard'
import { buildAuthCookieClearOptions, buildAuthCookieOptions } from './auth-config'

export class LoginDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(120, { message: '邮箱长度不能超过 120 位' })
  email!: string

  @IsString()
  @MinLength(8, { message: '密码长度至少 8 位' })
  @MaxLength(128, { message: '密码长度不能超过 128 位' })
  password!: string
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.authService.login(body.email, body.password)
    res.cookie('auth_token', token, buildAuthCookieOptions())
    return { user }
  }

  @Post('register')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async register(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.authService.register(body.email, body.password)
    res.cookie('auth_token', token, buildAuthCookieOptions())
    return { user }
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('auth_token', buildAuthCookieClearOptions())
    return { ok: true }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: any) {
    const userId = req.user.userId as string
    const user = await this.authService.me(userId)
    return { user }
  }
}

