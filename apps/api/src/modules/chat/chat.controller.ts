import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { Response } from 'express'

import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { ChatService } from './chat.service'

class CreateSessionDto {
  title?: string
}

class ChatStreamAttachmentDto {
  /** image：走多模态 vision；file：服务端抽取正文后注入上下文 */
  kind!: 'image' | 'file'
  name!: string
  mimeType!: string
  /** 标准 Base64（无 data: 前缀） */
  base64!: string
}

class StreamChatDto {
  sessionId?: string
  message!: string
  model?: string
  attachments?: ChatStreamAttachmentDto[]
}

class UpdateSessionTitleDto {
  title!: string
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('config')
  @UseGuards(JwtAuthGuard)
  config() {
    return this.chat.getChatConfig()
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async listSessions(@Req() req: any) {
    const userId = req.user.userId as string
    return this.chat.listSessions(userId)
  }

  @Post('sessions')
  @UseGuards(JwtAuthGuard)
  async createSession(@Req() req: any, @Body() body?: CreateSessionDto) {
    const userId = req.user.userId as string
    return this.chat.createSession(userId, body?.title)
  }

  @Get('sessions/:id/brief')
  @UseGuards(JwtAuthGuard)
  async sessionBrief(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const userId = req.user.userId as string
    const row = await this.chat.getSessionBrief(userId, id)
    if (!row) throw new NotFoundException('Session not found')
    return row
  }

  /** 更具体的路径须先于 `sessions/:id`，避免部分环境下路由匹配异常 */
  @Get('sessions/:id/messages')
  @UseGuards(JwtAuthGuard)
  async listMessages(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const userId = req.user.userId as string
    return this.chat.listMessages(userId, id)
  }

  /**
   * 部分网关/静态托管对 DELETE 返回 404，故提供 POST 删除（与 DELETE 行为一致）。
   */
  @Post('sessions/:id/delete')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async removeSessionPost(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const userId = req.user.userId as string
    await this.chat.deleteSession(userId, id)
    return { ok: true }
  }

  @Patch('sessions/:id')
  @UseGuards(JwtAuthGuard)
  async patchSession(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSessionTitleDto,
  ) {
    const userId = req.user.userId as string
    await this.chat.updateSessionTitle(userId, id, body?.title || '')
    return { ok: true }
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  async removeSession(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const userId = req.user.userId as string
    await this.chat.deleteSession(userId, id)
    return { ok: true }
  }

  @Post('stream')
  @UseGuards(JwtAuthGuard)
  async stream(@Req() req: any, @Res() res: Response, @Body() body?: StreamChatDto) {
    const userId = req.user.userId as string
    const sessionId = body?.sessionId
    const message = body?.message
    const model = body?.model
    const attachments = body?.attachments

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const abortController = new AbortController()
    req.on('close', () => abortController.abort())

    const writeEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const hasAttachments = Array.isArray(attachments) && attachments.length > 0
      if ((!message || !message.trim()) && !hasAttachments) {
        writeEvent('error', { message: 'Empty message' })
        res.end()
        return
      }

      await this.chat.streamAnswer({
        userId,
        sessionId,
        message: message ?? '',
        model,
        attachments,
        abortSignal: abortController.signal,
        onMeta: (meta) => writeEvent('meta', meta),
        onToken: (token) => writeEvent('token', { token }),
        onDone: (donePayload) => writeEvent('done', donePayload),
      })
      res.end()
    } catch (err: any) {
      writeEvent('error', { message: err?.message || 'Unknown error' })
      res.end()
    }
  }
}
