import IORedis from 'ioredis'
import type { MessageHistory } from '../agents/types.ts'
import { ENV } from '../config/env.ts'
import { createLogger } from './logger.ts'

const log = createLogger('redis')

/**
 * Initialize Redis client
 * Uses REDIS_URL environment variable
 * Returns null if not configured
 */
const createRedisClient = (): IORedis | null => {
  if (!ENV.REDIS_URL) {
    log.warn('REDIS_URL not configured - history feature disabled')
    return null
  }

  log.info('Redis client initialized')
  return new IORedis(ENV.REDIS_URL)
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
    const data = await redis.get(key)
    if (!data) return []
    return JSON.parse(data) as MessageHistory[]
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
    const data = await redis.get(key)
    let history: MessageHistory[] = data ? JSON.parse(data) : []

    // Add the new message
    history.push(message)

    // Keep only the last MAX_MESSAGES messages (FIFO)
    if (history.length > ENV.MAX_CONVERSATION_MESSAGES) {
      history = history.slice(-ENV.MAX_CONVERSATION_MESSAGES)
    }

    // Store with TTL
    await redis.setex(key, ENV.CONVERSATION_TTL, JSON.stringify(history))
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
