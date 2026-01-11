import { Redis } from '@upstash/redis'
import type { MessageHistory } from '../agents/types.ts'
import { createLogger } from './logger.ts'

const log = createLogger('redis')

const CONVERSATION_TTL = parseInt(process.env.CONVERSATION_TTL || '86400', 10) // Default: 24 hours in seconds
const MAX_MESSAGES = parseInt(process.env.MAX_CONVERSATION_MESSAGES || '100', 10) // Default: 100 messages

/**
 * Initialize Upstash Redis client
 * Returns null if credentials are not configured
 */
const createRedisClient = (): Redis | null => {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    log.warn('Upstash Redis credentials not configured - history feature disabled')
    return null
  }

  log.info({ url: url.substring(0, 30) + '...' }, 'Redis client initialized')
  return new Redis({ url, token })
}

const redis = createRedisClient()

/**
 * Get the Redis key for a channel's conversation history
 */
const getChannelKey = (channelId: string): string => {
  return `conversation:${channelId}`
}

/**
 * Retrieve conversation history for a channel
 * @param channelId The Discord channel ID
 * @returns Array of message history, empty if none exists or on error
 */
export const getChannelHistory = async (channelId: string): Promise<MessageHistory[]> => {
  if (!redis) return []

  try {
    const key = getChannelKey(channelId)
    const history = await redis.get<MessageHistory[]>(key)
    return history || []
  } catch (error) {
    log.error(
      { err: error, channelId },
      'Failed to fetch channel history - continuing without history',
    )
    return []
  }
}

/**
 * Add a message to the channel's conversation history
 * @param channelId The Discord channel ID
 * @param message The message to add
 */
export const addMessage = async (channelId: string, message: MessageHistory): Promise<void> => {
  if (!redis) return

  try {
    const key = getChannelKey(channelId)
    let history = (await redis.get<MessageHistory[]>(key)) || []

    // Add the new message
    history.push(message)

    // Keep only the last MAX_MESSAGES messages (FIFO)
    if (history.length > MAX_MESSAGES) {
      history = history.slice(-MAX_MESSAGES)
    }

    // Store with TTL
    await redis.setex(key, CONVERSATION_TTL, history)
  } catch (error) {
    log.error({ err: error, channelId }, 'Failed to add message to history')
  }
}

/**
 * Clear conversation history for a channel
 * @param channelId The Discord channel ID
 */
export const clearChannelHistory = async (channelId: string): Promise<void> => {
  if (!redis) return

  try {
    const key = getChannelKey(channelId)
    await redis.del(key)
  } catch (error) {
    log.error({ err: error, channelId }, 'Failed to clear channel history')
  }
}
