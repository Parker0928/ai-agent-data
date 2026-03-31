import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'

import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { OverviewService } from './overview.service'

@Controller('overview')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async dashboard(@Req() req: any, @Query('trendWindow') trendWindow?: string) {
    const userId = req.user.userId as string
    const w = trendWindow === '30d' ? '30d' : '7d'
    return this.overview.dashboard(userId, w)
  }
}

