import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common'
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator'

import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { HistoryService } from './history.service'

class BulkSessionIdsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  ids!: string[]
}

const bulkPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
})

@Controller('history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async stats(@Req() req: any) {
    const userId = req.user.userId as string
    return this.history.getStats(userId)
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async list(
    @Req() req: any,
    @Query('q') q?: string,
    @Query('days') days?: string,
    @Query('scope') scope?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user.userId as string
    return this.history.listSessions(userId, {
      q,
      days: days !== undefined && days !== '' ? Number(days) : undefined,
      scope,
      page: page !== undefined && page !== '' ? Number(page) : undefined,
      limit: limit !== undefined && limit !== '' ? Number(limit) : undefined,
    })
  }

  @Post('sessions/bulk-delete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @UsePipes(bulkPipe)
  async bulkDelete(@Req() req: any, @Body() body: BulkSessionIdsDto) {
    const userId = req.user.userId as string
    return this.history.bulkDelete(userId, body.ids)
  }

  @Post('sessions/bulk-archive')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @UsePipes(bulkPipe)
  async bulkArchive(@Req() req: any, @Body() body: BulkSessionIdsDto) {
    const userId = req.user.userId as string
    return this.history.bulkArchive(userId, body.ids)
  }

  @Post('sessions/bulk-unarchive')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @UsePipes(bulkPipe)
  async bulkUnarchive(@Req() req: any, @Body() body: BulkSessionIdsDto) {
    const userId = req.user.userId as string
    return this.history.bulkUnarchive(userId, body.ids)
  }

  @Post('sessions/:sessionId/archive')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async archive(@Req() req: any, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    const userId = req.user.userId as string
    return this.history.archiveSession(userId, sessionId)
  }

  @Post('sessions/:sessionId/unarchive')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async unarchive(@Req() req: any, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    const userId = req.user.userId as string
    return this.history.unarchiveSession(userId, sessionId)
  }
}
