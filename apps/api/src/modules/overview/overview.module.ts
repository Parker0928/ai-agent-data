import { Module } from '@nestjs/common'
import { OverviewController } from './overview.controller'
import { OverviewService } from './overview.service'
import { DatabaseModule } from '../database/database.module'
import { MarketModule } from '../market/market.module'

@Module({
  imports: [DatabaseModule, MarketModule],
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}

