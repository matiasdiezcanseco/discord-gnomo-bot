import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common'
import { type Message } from 'discord.js'
import { ConfigService } from '@nestjs/config'
import { LoggerService } from '../services/logger/logger.service'
import { DiscordService } from './discord.service'
import { normalizeInvocation } from './normalize-invocation'
import type { createConversation } from '../../conversation/harness'
import { runtimeAllows } from '../../conversation/runtime-policy'

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
    void this.handleMessage(message).catch(() =>
      this.logger.error('Invocation failed', 'conversation'),
    )
  }
  onModuleInit() {
    this.discord.getClient().on('messageCreate', this.receive)
  }
  onModuleDestroy() {
    this.discord.getClient().off('messageCreate', this.receive)
  }
  async handleMessage(message: Message): Promise<void> {
    const invocation = normalizeInvocation(
      message,
      this.config.get<string>('GUILD_ID'),
      this.discord.getClient().user?.id,
    )
    if (!invocation || !runtimeAllows(this.config, invocation)) return
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
    const send = () => void channel.sendTyping().catch(() => {})
    send()
    const timer = setInterval(send, 8000)
    return () => clearInterval(timer)
  }
}
