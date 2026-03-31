import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { HealthController } from './modules/health/health.controller'
import { AuthModule } from './modules/auth/auth.module'
import { KnowledgeModule } from './modules/knowledge/knowledge.module'
import { ChatModule } from './modules/chat/chat.module'
import { DatabaseModule } from './modules/database/database.module'
import { OverviewModule } from './modules/overview/overview.module'
import { AnalysisModule } from './modules/analysis/analysis.module'
import { MarketModule } from './modules/market/market.module'
import { HistoryModule } from './modules/history/history.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.development', '.env.staging', '.env.production'],
    }),
    DatabaseModule,
    AuthModule,
    KnowledgeModule,
    ChatModule,
    OverviewModule,
    AnalysisModule,
    MarketModule,
    HistoryModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

