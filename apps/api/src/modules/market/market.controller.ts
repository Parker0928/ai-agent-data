import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'

import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { MarketService } from './market.service'

@Controller('market')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  /** 单个智能体（对话页 ?agent= 预填、详情抽屉） */
  @Get('agents/:id')
  @UseGuards(JwtAuthGuard)
  async agent(@Req() req: any, @Param('id') agentId: string) {
    const userId = req.user.userId as string
    return this.marketService.getAgent(userId, agentId)
  }

  @Post('agents/:id/pin')
  @UseGuards(JwtAuthGuard)
  async pin(@Req() req: any, @Param('id') agentId: string) {
    const userId = req.user.userId as string
    return this.marketService.pinAgent(userId, agentId)
  }

  @Delete('agents/:id/pin')
  @UseGuards(JwtAuthGuard)
  async unpin(@Req() req: any, @Param('id') agentId: string) {
    const userId = req.user.userId as string
    return this.marketService.unpinAgent(userId, agentId)
  }

  /** 市场首页：目录 + 分类 + 我的置顶 id */
  @Get()
  @UseGuards(JwtAuthGuard)
  async home(
    @Req() req: any,
    @Query('category') category?: string,
    @Query('q') q?: string,
  ) {
    const userId = req.user.userId as string
    return this.marketService.getMarketPayload(userId, { category, q })
  }
}
