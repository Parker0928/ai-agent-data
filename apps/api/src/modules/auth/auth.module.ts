import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { ConfigModule, ConfigService } from '@nestjs/config'

import { AuthController } from './auth.controller'
import { AuthLegacyExpressHook } from './auth-legacy-express.hook'
import { AuthService } from './auth.service'
import { JwtStrategy } from './jwt.strategy'
import { getJwtExpiresIn, getJwtSecret } from './auth-config'
import { DatabaseModule } from '../database/database.module'

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: getJwtSecret(config),
        signOptions: {
          expiresIn: getJwtExpiresIn(config) as any,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, AuthLegacyExpressHook],
  exports: [AuthService],
})
export class AuthModule {}

