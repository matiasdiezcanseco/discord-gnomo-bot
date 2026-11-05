import { Injectable, OnModuleInit, Optional, Inject } from '@nestjs/common'
import { ChannelType, type Message } from 'discord.js'
import { ConfigService } from '@nestjs/config'
import { OrchestratorService } from '../../core/orchestrator/orchestrator.service'
import { RedisHistoryService } from '../services/redis/redis-history.service'
import { LoggerService } from '../services/logger/logger.service'
import { DiscordService } from './discord.service'
import { getRandomConfusedPhrase } from './utils/confused-phrases'
import { withTypingIndicator } from './utils/typing-indicator'
import { sanitizeResponse } from '../../core/orchestrator/utils/text-utils'
import {
  createUserMessage,
  createBotMessage,
  replaceUserMentionsWithNames,
} from './utils/message-utils'
import { normalizeInvocation } from './normalize-invocation'
import { respondToInvocation } from '../../core/conversation/invocation'
import type { BotContext } from '../../core/context/bot-context'
import type { createConversation } from '../../conversation/harness'

@Injectable()
export class MessageHandlerService implements OnModuleInit {
  private readonly logger

  constructor(
    private readonly config: ConfigService,
    private readonly discord: DiscordService,
    private readonly orchestrator: OrchestratorService,
    private readonly redisHistory: RedisHistoryService,
    loggerService: LoggerService,
    @Optional()
    @Inject('PILOT_CONVERSATION')
    private readonly pilot?: Pick<ReturnType<typeof createConversation>, 'handle'>,
  ) {
    this.logger = loggerService.createLogger('message-handler')
  }

  async onModuleInit() {
    const client = this.discord.getClient()

    client.on('messageCreate', (msg) => this.handleMessage(msg))
  }

  async handleMessage(msg: Message): Promise<void> {
    const botUserId = this.discord.getClient().user?.id
    const invocation = normalizeInvocation(msg, this.config.get<string>('GUILD_ID'), botUserId)
    if (!invocation || msg.channel.type === ChannelType.GroupDM) return

    const pilotChannels = this.config
      .get<string>('CONVERSATION_PILOT_CHANNEL_IDS', '')
      .split(',')
      .map((id) => id.trim())
    if (pilotChannels.includes(invocation.channelId)) {
      if (!this.pilot) return // Fail closed; never silently fall back to unapproved legacy tools.
      await this.pilot.handle(invocation, async (_origin, reply) => {
        await msg.reply(reply)
      })
      return
    }

    const channel = msg.channel
    const content = replaceUserMentionsWithNames(invocation.content, botUserId!, (userId) => {
      const member = msg.mentions.members?.get(userId)
      return member?.displayName || member?.user?.username
    })
    const userInfo = { userId: invocation.requester.id, username: invocation.requester.username }
    const channelId = invocation.channelId
    const images = invocation.attachments.flatMap((attachment) =>
      attachment.contentType?.startsWith('image/')
        ? [{ url: attachment.url, name: attachment.name, contentType: attachment.contentType }]
        : [],
    )

    await respondToInvocation(invocation, {
      respond: async () =>
        withTypingIndicator(channel, async () => {
          const [history] = await Promise.all([
            this.redisHistory.getChannelHistory(channelId),
            this.redisHistory.addMessage(channelId, createUserMessage(userInfo, content)),
          ])

          const ctx: BotContext = {
            message: content,
            userInfo,
            channel: { id: channelId },
            guildId: invocation.guildId,
            images,
            history,
            guild: msg.guild!,
          }

          return this.orchestrator.handle(ctx)
        }),
      reply: async (_origin, response) => {
        if (response.success && response.text) {
          this.logger.info('Message handled')

          await this.redisHistory.addMessage(
            channelId,
            createBotMessage(
              this.discord.getClient().user!.username,
              this.discord.getClient().user!.id,
              response.text,
            ),
          )

          await msg.reply(response.text)
        } else {
          const confusedPhrase = sanitizeResponse(getRandomConfusedPhrase())
          await msg.reply(confusedPhrase)
        }
      },
    })
  }
}
