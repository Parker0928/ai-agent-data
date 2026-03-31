import { Module } from '@nestjs/common'
import { KnowledgeController } from './knowledge.controller'
import { KnowledgeService } from './knowledge.service'
import { DatabaseModule } from '../database/database.module'

@Module({
  imports: [DatabaseModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}

