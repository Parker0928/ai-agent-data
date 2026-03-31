import { Module } from '@nestjs/common'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { DatabaseModule } from '../database/database.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'

@Module({
  imports: [DatabaseModule, KnowledgeModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}

