import { ChannelType, type Client, type Message } from 'discord.js'
import type { AssistantAgent } from '../agents/assistant-agent.ts'
import { ENV } from '../config/env.ts'
import { getChannelHistory, addMessage } from '../services/redis-service.ts'
import { createLogger } from '../services/logger.ts'
import { getRandomConfusedPhrase } from '../utils/confused-phrases.ts'
import { withTypingIndicator } from '../utils/typing-indicator.ts'
import {
  createUserMessage,
  createBotMessage,
  extractMessageContent,
  extractUserInfo,
} from '../utils/message-utils.ts'

const log = createLogger('message-handler')

/**
 * Handle incoming Discord messages
 */
export async function handleMessage(
  msg: Message,
  client: Client,
  assistantAgent: AssistantAgent,
): Promise<void> {
  // Ignore bot messages
  if (msg.author.bot) return

  // Only respond in configured guild
  if (msg.guild?.id !== ENV.GUILD_ID) return

  log.debug({ username: msg.author.username, content: msg.content }, 'Message received')

  // Check if the bot is mentioned
  if (!client.user || !msg.mentions.has(client.user.id)) return

  // Skip unsupported channel types (e.g., PartialGroupDMChannel)
  if (msg.channel.type === ChannelType.GroupDM) return

  const content = extractMessageContent(msg.content)
  const userInfo = extractUserInfo(msg.author)
  const channelId = msg.channel.id

  // Get conversation history and store user message
  const history = await getChannelHistory(channelId)
  await addMessage(channelId, createUserMessage(userInfo, content))

  // Process message with typing indicator
  const response = await withTypingIndicator(msg.channel, () =>
    assistantAgent.handle(content, userInfo, history, msg.guild),
  )

  if (response.success && response.text) {
    log.info({ agent: response.agentName }, 'Message handled')

    // Store bot response in history
    await addMessage(
      channelId,
      createBotMessage(client.user.username, client.user.id, response.text),
    )

    await msg.reply(response.text)
  } else {
    await msg.reply(getRandomConfusedPhrase())
  }
}
