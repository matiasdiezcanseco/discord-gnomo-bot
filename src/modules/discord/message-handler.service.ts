import { Injectable, OnModuleInit } from '@nestjs/common'
import { ChannelType, type Message, type TextChannel } from 'discord.js'
import { AssistantAgent } from '../agents/assistant-agent'
import { ConfigService } from '@nestjs/config'
import { RedisHistoryService } from '../services/redis/redis-history.service'
import { LoggerService } from '../services/logger/logger.service'
import { DiscordService } from './discord.service'
import { getRandomConfusedPhrase } from './utils/confused-phrases'
import { withTypingIndicator } from './utils/typing-indicator'
import { sanitizeResponse } from '../agents/utils/text-utils'
import {
  createUserMessage,
  createBotMessage,
  extractUserInfo,
  replaceUserMentionsWithNames,
} from './utils/message-utils'
import type { ImageAttachment } from '../agents/utils/agent-types'

/**
 * Handles incoming Discord messages and routes them to assistant agent
 */
@Injectable()
export class MessageHandlerService implements OnModuleInit {
  private readonly logger

  constructor(
    private readonly config: ConfigService,
    private readonly discord: DiscordService,
    private readonly assistantAgent: AssistantAgent,
    private readonly redisHistory: RedisHistoryService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.createLogger('message-handler')
  }

  async onModuleInit() {
    const client = this.discord.getClient()

    client.on('messageCreate', (msg) => this.handleMessage(msg))
  }

  /**
   * Extract image attachments from Discord message
   */
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

  /**
   * Handle incoming Discord messages
   */
  async handleMessage(msg: Message): Promise<void> {
    // Ignore bot messages
    if (msg.author.bot) return

    // Only respond in configured guild
    const guildId = this.config.get<string>('GUILD_ID')
    if (msg.guild?.id !== guildId) return

    this.logger.debug({ username: msg.author.username, content: msg.content }, 'Message received')

    // Check if bot is mentioned
    if (!this.discord.getClient().user || !msg.mentions.has(this.discord.getClient().user!.id))
      return

    // Skip unsupported channel types (e.g., PartialGroupDMChannel)
    if (msg.channel.type === ChannelType.GroupDM) return

    const botUserId = this.discord.getClient().user!.id

    // Replace user mentions with readable usernames for AI understanding
    const content = replaceUserMentionsWithNames(msg.content, botUserId, (userId) => {
      const member = msg.mentions.members?.get(userId)
      return member?.displayName || member?.user?.username
    })
    const userInfo = extractUserInfo(msg.author)
    const channelId = msg.channel.id

    // Extract image attachments
    const images = this.extractImages(msg)

    // Get conversation history and store user message
    const history = await this.redisHistory.getChannelHistory(channelId)
    await this.redisHistory.addMessage(channelId, createUserMessage(userInfo, content))

    // Get channel as TextChannel for reminder functionality
    const channel = msg.channel.type === ChannelType.GuildText ? (msg.channel as TextChannel) : null

    // Process message with typing indicator
    const response = await withTypingIndicator(msg.channel, () =>
      this.assistantAgent.handle(content, userInfo, history, msg.guild, channel, images),
    )

    if (response.success && response.text) {
      this.logger.info({ agent: response.agentName }, 'Message handled')

      // Store bot response in history
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
