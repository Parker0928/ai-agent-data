import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'

import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AnalysisService, type AnalysisTrendDays } from './analysis.service'

@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  /** ?trendDays=7|30 控制趋势图与环比窗口，默认 7 */
  @Get()
  @UseGuards(JwtAuthGuard)
  async insights(@Req() req: any, @Query('trendDays') trendDays?: string) {
    const userId = req.user.userId as string
    const d = trendDays === '30' ? 30 : 7
    return this.analysis.insights(userId, d as AnalysisTrendDays)
  }
}

