import { Injectable, OnModuleInit } from '@nestjs/common'
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
  extractUserInfo,
  replaceUserMentionsWithNames,
} from './utils/message-utils'
import type { BotContext, ImageAttachment } from '../../core/context/bot-context'

@Injectable()
export class MessageHandlerService implements OnModuleInit {
  private readonly logger

  constructor(
    private readonly config: ConfigService,
    private readonly discord: DiscordService,
    private readonly orchestrator: OrchestratorService,
    private readonly redisHistory: RedisHistoryService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.createLogger('message-handler')
  }

  async onModuleInit() {
    const client = this.discord.getClient()

    client.on('messageCreate', (msg) => this.handleMessage(msg))
  }

  private extractImages(msg: Message): ImageAttachment[] {
    const images: ImageAttachment[] = []

    for (const attachment of msg.attachments.values()) {
      if (attachment.contentType?.startsWith('image/')) {
        images.push({
          url: attachment.url,
          name: attachment.name,
          contentType: attachment.contentType,
        })
      }
    }

    return images
  }

  async handleMessage(msg: Message): Promise<void> {
    if (msg.author.bot) return

    const guildId = this.config.get<string>('GUILD_ID')
    if (msg.guild?.id !== guildId) return

    this.logger.debug({ username: msg.author.username, content: msg.content }, 'Message received')

    if (!this.discord.getClient().user || !msg.mentions.has(this.discord.getClient().user!.id))
      return

    if (msg.channel.type === ChannelType.GroupDM) return

    const botUserId = this.discord.getClient().user!.id

    const content = replaceUserMentionsWithNames(msg.content, botUserId, (userId) => {
      const member = msg.mentions.members?.get(userId)
      return member?.displayName || member?.user?.username
    })
    const userInfo = extractUserInfo(msg.author)
    const channelId = msg.channel.id
    const images = this.extractImages(msg)

    const response = await withTypingIndicator(msg.channel, async () => {
      const [history] = await Promise.all([
        this.redisHistory.getChannelHistory(channelId),
        this.redisHistory.addMessage(channelId, createUserMessage(userInfo, content)),
      ])

      const ctx: BotContext = {
        message: content,
        userInfo,
        channel: { id: channelId },
        guildId: msg.guild!.id,
        images,
        history,
        guild: msg.guild!,
      }

      return this.orchestrator.handle(ctx)
    })

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
  }
}
