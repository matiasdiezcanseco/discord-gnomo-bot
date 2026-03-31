import type { MessageHistory, UserInfo } from '../../../core/context/bot-context'

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
 * Replace user mentions in message content with readable usernames
 * Preserves the @ symbol so AI understands it's a user reference
 * @param content The message content
 * @param botId The bot's user ID to exclude from replacement
 * @param getUserNameById Function to get username by ID
 * @returns Content with user mentions replaced by @username
 */
export function replaceUserMentionsWithNames(
  content: string,
  botId: string,
  getUserNameById: (userId: string) => string | undefined,
): string {
  return content
    .replace(/<@!?(\d+)>/g, (match, userId) => {
      if (userId === botId) {
        return ''
      }
      const username = getUserNameById(userId)
      return username ? `@${username}` : match
    })
    .trim()
}

/**
 * Extract message content by removing bot mentions only
 * Discord mentions come in format <@BOT_ID> or <@!BOT_ID>
 * @deprecated Use replaceUserMentionsWithNames instead for better AI understanding
 */
export function extractMessageContent(content: string): string {
  return content.replace(/<@!?\\d+>/g, '').trim()
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
