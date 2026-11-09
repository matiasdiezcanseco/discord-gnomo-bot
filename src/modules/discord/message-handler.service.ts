import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common'
import { type Message } from 'discord.js'
import { ConfigService } from '@nestjs/config'
import { LoggerService } from '../services/logger/logger.service'
import { DiscordService } from './discord.service'
import { normalizeInvocation } from './normalize-invocation'
import type { createConversation } from '../../conversation/harness'
import { runtimeAllows } from '../../conversation/runtime-policy'
import { describeError, reportError } from '../../diagnostics'

@Injectable()
export class MessageHandlerService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly config: ConfigService,
    private readonly discord: DiscordService,
    private readonly logger: LoggerService,
    @Inject('CONVERSATION')
    private readonly conversation: Pick<ReturnType<typeof createConversation>, 'handle'>,
  ) {}
  private readonly receive = (message: Message) => {
    void this.handleMessage(message).catch((error) =>
      this.logger
        .createLogger('conversation')
        .error(
          { invocationId: message.id, channelId: message.channelId, error: describeError(error) },
          'Invocation failed',
        ),
    )
  }
  onModuleInit() {
    this.discord.getClient().on('messageCreate', this.receive)
  }
  onModuleDestroy() {
    this.discord.getClient().off('messageCreate', this.receive)
  }
  async handleMessage(message: Message): Promise<void> {
    const guildId = this.config.get<string>('GUILD_ID')
    const botId = this.discord.getClient().user?.id
    const invocation = normalizeInvocation(message, guildId, botId)
    if (!invocation || !runtimeAllows(this.config, invocation)) {
      // Only messages that tag the bot: "why didn't it answer?" must be answerable from the logs.
      if (botId && new RegExp(`<@!?${botId}>`).test(message.content ?? ''))
        this.logger.createLogger('receiver').info(
          {
            invocationId: message.id,
            guildId: message.guildId,
            channelId: message.channelId,
            requesterId: message.author?.id,
            reason: message.author?.bot
              ? 'author is a bot'
              : !guildId
                ? 'GUILD_ID not configured'
                : message.guildId !== guildId
                  ? 'message from another guild'
                  : `runtime policy (RUNTIME_MODE=${this.config.get<string>('RUNTIME_MODE', 'paused')}, channel not in RUNTIME_CHANNEL_IDS?)`,
          },
          'Tagged message ignored',
        )
      return
    }
    const stopTyping = this.showTyping(message)
    try {
      await this.conversation.handle(invocation, async (_origin, reply) => {
        stopTyping()
        await message.reply(reply)
      })
    } finally {
      stopTyping()
    }
  }
  /** Discord shows "typing…" for ~10s per call, so it is refreshed until the reply is sent. */
  private showTyping(message: Message): () => void {
    const channel = message.channel
    if (!('sendTyping' in channel)) return () => {}
    const send = () =>
      void channel.sendTyping().catch((error) => reportError('discord.typing', error))
    send()
    const timer = setInterval(send, 8000)
    return () => clearInterval(timer)
  }
}
