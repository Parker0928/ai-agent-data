import { Module } from '@nestjs/common'
import { AnalysisController } from './analysis.controller'
import { AnalysisService } from './analysis.service'
import { DatabaseModule } from '../database/database.module'

@Module({
  imports: [DatabaseModule],
  controllers: [AnalysisController],
  providers: [AnalysisService],
})
export class AnalysisModule {}

