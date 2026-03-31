import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { DatabaseService } from '../database/database.service'

type JwtPayload = {
  sub: string
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(ConfigService) config: ConfigService,
    private readonly db: DatabaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') || 'dev-secret',
    })
  }

  async validate(payload: JwtPayload) {
    const userId = payload.sub
    const res = await this.db.query<{ id: string }>('SELECT id FROM users WHERE id = $1', [userId])
    if (res.rows.length === 0) throw new UnauthorizedException('User not found')
    return { userId }
  }
}

