import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common'
import bcrypt from 'bcrypt'
import { JwtService } from '@nestjs/jwt'
import { DatabaseService } from '../database/database.service'

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit() {
    // Seed a dev user for local development.
    // If you don't want this, set SEED_DEV_USER=false.
    const seed = process.env.SEED_DEV_USER !== 'false'
    if (!seed) return

    const email = process.env.DEV_USER_EMAIL || 'dev@example.com'
    const password = process.env.DEV_USER_PASSWORD || 'dev-password'

    const existing = await this.db.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [email],
    )
    if (existing.rows.length > 0) return

    const passwordHash = await bcrypt.hash(password, 10)
    await this.db.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2)',
      [email, passwordHash],
    )
    // eslint-disable-next-line no-console
    console.log(`[auth] seeded dev user: ${email} / ${password}`)
  }

  async login(email: string, password: string) {
    const normalizedEmail = this.normalizeEmail(email)
    if (!normalizedEmail) throw new UnauthorizedException('Invalid credentials')
    const res = await this.db.query<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE email = $1 LIMIT 1',
      [normalizedEmail],
    )

    if (res.rows.length === 0) throw new UnauthorizedException('Invalid credentials')
    const user = res.rows[0]

    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) throw new UnauthorizedException('Invalid credentials')

    const token = await this.jwt.signAsync({ sub: user.id })
    return { token, user: { id: user.id, email: normalizedEmail } }
  }

  async register(email: string, password: string) {
    const normalizedEmail = this.normalizeEmail(email)
    if (!normalizedEmail) throw new BadRequestException('邮箱格式不正确')
    this.assertPassword(password)

    const exists = await this.db.query<{ id: string }>('SELECT id FROM users WHERE email = $1 LIMIT 1', [
      normalizedEmail,
    ])
    if (exists.rows.length > 0) {
      throw new ConflictException('该邮箱已注册')
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const created = await this.db.query<{ id: string; email: string }>(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [normalizedEmail, passwordHash],
    )
    const user = created.rows[0]
    const token = await this.jwt.signAsync({ sub: user.id })
    return { token, user: { id: user.id, email: user.email } }
  }

  async me(userId: string) {
    const res = await this.db.query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE id = $1 LIMIT 1',
      [userId],
    )
    if (res.rows.length === 0) throw new UnauthorizedException('User not found')
    return res.rows[0]
  }

  private normalizeEmail(email: string) {
    const v = String(email || '').trim().toLowerCase()
    if (!v) return ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return ''
    return v
  }

  private assertPassword(password: string) {
    const pwd = String(password || '')
    if (pwd.length < 8) {
      throw new BadRequestException('密码长度至少 8 位')
    }
    if (pwd.length > 128) {
      throw new BadRequestException('密码长度不能超过 128 位')
    }
  }
}

