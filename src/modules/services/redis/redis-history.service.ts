import { Injectable, OnModuleDestroy, Inject } from '@nestjs/common'
import IORedis from 'ioredis'
import { ConfigService } from '@nestjs/config'
import { LoggerService } from '../logger/logger.service'
import type { MessageHistory } from '../../agents/utils/agent-types'

@Injectable()
export class RedisHistoryService implements OnModuleDestroy {
  constructor(
    @Inject('REDIS_CONNECTION') private readonly redis: IORedis | null,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    if (!redis) {
      logger.warn('REDIS_URL not configured - history feature disabled', 'redis-history')
    } else {
      logger.log('Redis client initialized', 'redis-history')
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit()
    }
  }

  /**
   * Get the Redis key for a channel's conversation history
   */
  private getChannelKey(channelId: string): string {
    return `conversation:${channelId}`
  }

  /**
   * Ping Redis to check connection
   */
  async ping(): Promise<string | null> {
    if (!this.redis) {
      throw new Error('Redis not configured')
    }
    return await this.redis.ping()
  }

  /**
   * Retrieve conversation history for a channel
   * @param channelId The Discord channel ID
   * @returns Array of message history, empty if none exists or on error
   */
  async getChannelHistory(channelId: string): Promise<MessageHistory[]> {
    if (!this.redis) return []

    try {
      const key = this.getChannelKey(channelId)
      const items = await this.redis.lrange(key, 0, -1)
      if (!items.length) return []
      return items.map((item) => JSON.parse(item) as MessageHistory)
    } catch (error) {
      this.logger.error(
        { err: error, channelId },
        'Failed to fetch channel history - continuing without history',
        'redis-history',
      )
      return []
    }
  }

  /**
   * Add a message to the channel's conversation history
   * @param channelId The Discord channel ID
   * @param message The message to add
   */
  async addMessage(channelId: string, message: MessageHistory): Promise<void> {
    if (!this.redis) return

    try {
      const key = this.getChannelKey(channelId)
      const maxMessages = this.config.get<number>('MAX_CONVERSATION_MESSAGES') ?? 100
      const ttl = this.config.get<number>('CONVERSATION_TTL') ?? 3600

      const pipeline = this.redis.pipeline()
      pipeline.rpush(key, JSON.stringify(message))
      pipeline.ltrim(key, -maxMessages, -1)
      pipeline.expire(key, ttl)
      await pipeline.exec()
    } catch (error) {
      this.logger.error(
        { err: error, channelId },
        'Failed to add message to history',
        'redis-history',
      )
    }
  }

  /**
   * Clear conversation history for a channel
   * @param channelId The Discord channel ID
   */
  async clearChannelHistory(channelId: string): Promise<void> {
    if (!this.redis) return

    try {
      const key = this.getChannelKey(channelId)
      await this.redis.del(key)
    } catch (error) {
      this.logger.error(
        { err: error, channelId },
        'Failed to clear channel history',
        'redis-history',
      )
    }
  }
}
