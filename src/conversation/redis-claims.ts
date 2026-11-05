import type Redis from 'ioredis'
import type { Invocation } from '../core/conversation/invocation'

/** Fail closed on Redis failure; never release a claim after an uncertain side effect. */
export function redisClaims(redis: Redis, namespace = 'gnomo:invocation:v1', ttlSeconds = 86400) {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) throw new Error('Invalid claim TTL')
  return async (invocation: Invocation): Promise<boolean> => {
    const key = `${namespace}:${encodeURIComponent(invocation.guildId)}:${encodeURIComponent(invocation.channelId)}:${encodeURIComponent(invocation.messageId)}`
    return (await redis.set(key, 'claimed', 'EX', ttlSeconds, 'NX')) === 'OK'
  }
}
