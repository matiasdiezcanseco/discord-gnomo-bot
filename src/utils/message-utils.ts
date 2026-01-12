import type { MessageHistory, UserInfo } from '../agents/types.ts'

/**
 * Create a user message history entry
 */
export function createUserMessage(userInfo: UserInfo, content: string): MessageHistory {
  return {
    role: 'user',
    username: userInfo.username,
    userId: userInfo.userId,
    content,
    timestamp: Date.now(),
  }
}

/**
 * Create a bot/assistant message history entry
 */
export function createBotMessage(
  botUsername: string,
  botId: string,
  content: string,
): MessageHistory {
  return {
    role: 'assistant',
    username: botUsername,
    userId: botId,
    content,
    timestamp: Date.now(),
  }
}

/**
 * Extract message content by removing bot mentions
 * Discord mentions come in format <@BOT_ID> or <@!BOT_ID>
 */
export function extractMessageContent(content: string): string {
  return content.replace(/<@!?\d+>/g, '').trim()
}

/**
 * Extract user info from a Discord message author
 */
export function extractUserInfo(author: { username: string; id: string }): UserInfo {
  return {
    username: author.username,
    userId: author.id,
  }
}
