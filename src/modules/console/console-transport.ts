import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Transport } from '../transport/transport'
import { LoggerService } from '../services/logger/logger.service'
import { ConsoleSession } from './console-session'
import { normalizeInvocation } from '../discord/normalize-invocation'
import { runtimeAllows } from '../../conversation/runtime-policy'
import { birthdayStillDue, type BirthdaySource } from '../../conversation/birthdays'
import {
  isBirthday,
  NoticeFailure,
  type ScheduledDelivery,
  type ScheduledOrigin,
} from '../../conversation/scheduled-notices'
import type { createConversation } from '../../conversation/harness'
import type { Invocation } from '../../core/conversation/invocation'
import type { ReplyFile } from '../../conversation/catalog'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Generated files land on disk so they can be opened locally; returns their paths. */
async function saveFiles(files: ReplyFile[] = []) {
  if (!files.length) return undefined
  const directory = join(tmpdir(), 'gnomo-console')
  await mkdir(directory, { recursive: true })
  return Promise.all(
    files.map(async (file) => {
      const path = join(directory, file.name.replace(/[^\w.-]/g, '_'))
      await writeFile(path, file.attachment)
      return path
    }),
  )
}

/** Terminal transport: same admission policy and notice rules as Discord, output to stdout. */
@Injectable()
export class ConsoleTransport extends Transport {
  readonly name = 'console'
  constructor(
    private readonly config: ConfigService,
    private readonly session: ConsoleSession,
  ) {
    super()
  }
  isReady() {
    return true
  }
  scheduledDelivery(source: BirthdaySource, now = Date.now): ScheduledDelivery {
    const deliverable = async (origin: ScheduledOrigin) => {
      if (!runtimeAllows(this.config, origin)) return false
      if (!isBirthday(origin)) return true
      return birthdayStillDue(origin, this.config.get<string>('GNOMOS_CHANNEL_ID'), source, now())
    }
    const checked = async (origin: ScheduledOrigin) => {
      try {
        return await deliverable(origin)
      } catch {
        throw new NoticeFailure('transient', 'Console revalidation failed before send')
      }
    }
    return {
      admits: (origin) => runtimeAllows(this.config, origin),
      authorize: checked,
      send: async (origin, reply) => {
        if (!(await checked(origin)))
          throw new NoticeFailure('permanent', 'permission revoked before send')
        this.session.post(this.session.bot, reply.content, origin.channelId)
        this.session.output({
          type: 'scheduled',
          channelId: origin.channelId,
          content: reply.content,
          kind: isBirthday(origin) ? 'birthday' : 'reminder',
        })
      },
    }
  }
}

/** The console counterpart of MessageHandlerService: one terminal line is one tagged message. */
@Injectable()
export class ConsoleReceiver {
  constructor(
    private readonly config: ConfigService,
    private readonly session: ConsoleSession,
    private readonly logger: LoggerService,
    @Inject('CONVERSATION')
    private readonly conversation: Pick<ReturnType<typeof createConversation>, 'handle'>,
  ) {}

  /** Posts the line mentioning the bot (as Discord users must) and waits for the reply. */
  async send(text: string, attachments: Invocation['attachments'] = []): Promise<void> {
    const { session } = this
    const message = session.post(session.requester, `<@${session.bot.id}> ${text}`)
    const invocation = normalizeInvocation(
      {
        id: message.messageId,
        guildId: session.guildId,
        channelId: message.channelId,
        createdTimestamp: message.createdAt,
        content: message.content,
        author: { ...session.requester, bot: false },
        attachments: new Map(attachments.map((attachment) => [attachment.id, attachment])),
      },
      this.config.get<string>('GUILD_ID'),
      session.bot.id,
    )
    if (!invocation || !runtimeAllows(this.config, invocation)) {
      session.output({
        type: 'ignored',
        reason: `RUNTIME_MODE=${this.config.get<string>('RUNTIME_MODE', 'paused')} no admite el canal ${message.channelId} del servidor ${session.guildId} (igual que en producción).`,
      })
      return
    }
    session.output({ type: 'typing', channelId: invocation.channelId })
    try {
      await this.conversation.handle(invocation, async (_origin, reply) => {
        session.post(session.bot, reply.content, invocation.channelId)
        const files = await saveFiles(reply.files)
        session.output({
          type: 'reply',
          channelId: invocation.channelId,
          content: reply.content,
          mentions: reply.allowedMentions.users,
          ...(files ? { files } : {}),
        })
      })
    } catch (error) {
      // Production only logs a safe line; locally the full error is what is being debugged.
      this.logger.error('Invocation failed', 'conversation')
      session.output({
        type: 'error',
        message: error instanceof Error ? (error.stack ?? error.message) : String(error),
      })
    } finally {
      session.release(attachments)
    }
  }
}
