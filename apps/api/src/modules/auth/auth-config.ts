import { ConfigService } from '@nestjs/config'

const DEV_FALLBACK_SECRET = 'dev-secret-change-me'

export function getJwtSecret(config: ConfigService): string {
  const secret = (config.get<string>('JWT_SECRET') || '').trim()
  if (secret) return secret

  const allowInsecureDev = process.env.ALLOW_INSECURE_DEV_JWT === 'true'
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase()
  if (allowInsecureDev && nodeEnv !== 'production') {
    return DEV_FALLBACK_SECRET
  }

  throw new Error(
    'Missing JWT_SECRET. Please set JWT_SECRET (or ALLOW_INSECURE_DEV_JWT=true for temporary local development only).',
  )
}

export function getJwtExpiresIn(config: ConfigService): string {
  return (config.get<string>('JWT_EXPIRES_IN') || '7d').trim()
}

export function buildAuthCookieOptions() {
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase()
  const secure = nodeEnv === 'production'
  return {
    httpOnly: true,
    secure,
    sameSite: (secure ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
    maxAge: Math.max(60, Number(process.env.JWT_COOKIE_MAX_AGE_SECONDS || 60 * 60 * 24 * 7)) * 1000,
  }
}

export function buildAuthCookieClearOptions() {
  const opts = buildAuthCookieOptions()
  return {
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
    path: opts.path,
  }
}
