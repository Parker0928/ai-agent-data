import { Controller, Get } from '@nestjs/common'

@Controller()
export class HealthController {
  /** 实际路径 /api/health（受全局前缀影响） */
  @Get('health')
  health() {
    return {
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: process.env.APP_ENV || process.env.NODE_ENV || 'development',
    }
  }

  /** 实际路径 /api/version */
  @Get('version')
  version() {
    return {
      name: '@apps/api',
      version: '0.1.0',
      env: process.env.APP_ENV || process.env.NODE_ENV || 'development',
    }
  }
}

