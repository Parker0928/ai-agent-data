import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { IsOptional, IsString } from 'class-validator'

import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { KnowledgeService } from './knowledge.service'

/** whitelist ValidationPipe 会去掉无装饰器字段；multipart 里的 url 必须保留 */
class UploadBodyDto {
  @IsOptional()
  @IsString()
  url?: string
}

class RagConfigDto {
  topK?: number
  similarityThreshold?: number
  chunkSize?: number
  chunkOverlap?: number
  /** semantic | fixed | paragraph */
  chunkStrategy?: string
}

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  )
  async upload(
    @Req() req: any,
    @UploadedFile() file?: Express.Multer.File,
    @Body() body?: UploadBodyDto,
  ) {
    const userId = req.user.userId as string
    const url = body?.url
    return this.knowledge.ingest({ userId, file, url })
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async stats(@Req() req: any) {
    const userId = req.user.userId as string
    return this.knowledge.getStats(userId)
  }

  @Get('docs/:id/chunks')
  @UseGuards(JwtAuthGuard)
  async docChunks(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) documentId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const userId = req.user.userId as string
    return this.knowledge.listDocumentChunks(userId, documentId, Number(limit), Number(offset))
  }

  @Delete('docs/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async deleteDoc(@Req() req: any, @Param('id', ParseUUIDPipe) documentId: string) {
    const userId = req.user.userId as string
    return this.knowledge.deleteDocument(userId, documentId)
  }

  @Get('docs')
  @UseGuards(JwtAuthGuard)
  async listDocs(@Req() req: any, @Query('q') q?: string) {
    const userId = req.user.userId as string
    return this.knowledge.listDocuments(userId, q)
  }

  @Put('config')
  @UseGuards(JwtAuthGuard)
  async saveConfig(@Req() req: any, @Body() cfg: RagConfigDto) {
    const userId = req.user.userId as string
    return this.knowledge.upsertRagConfig(userId, cfg)
  }

  @Get('config')
  @UseGuards(JwtAuthGuard)
  async getConfig(@Req() req: any) {
    const userId = req.user.userId as string
    return this.knowledge.getRagConfig(userId)
  }
}
