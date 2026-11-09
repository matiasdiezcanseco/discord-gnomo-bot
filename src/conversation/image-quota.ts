import type Redis from 'ioredis'
import { randomUUID } from 'node:crypto'
import type { Invocation } from '../core/conversation/invocation'

export type QuotaReservation =
  | { granted: true; release(): Promise<void> }
  | { granted: false; retryInMs: number }

/** One image per requester per window. The slot is taken before spending any credit. */
export interface ImageQuota {
  reserve(invocation: Invocation): Promise<QuotaReservation>
}

// Deletes the slot only while it is still the one this reservation took.
const releaseScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`

/**
 * Atomic per-user cooldown shared by every process using the same Redis: `SET NX EX` either takes
 * the slot or reports how long until it frees. Redis failures propagate, so callers fail closed.
 */
export function redisImageQuota(
  redis: Redis,
  windowSeconds = 3600,
  namespace = 'gnomo:image-quota:v1',
): ImageQuota {
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1)
    throw new Error('Invalid image quota window')
  return {
    async reserve(invocation) {
      const key = `${namespace}:${encodeURIComponent(invocation.guildId)}:${encodeURIComponent(invocation.requester.id)}`
      const token = randomUUID()
      for (let attempt = 0; attempt < 2; attempt++) {
        if ((await redis.set(key, token, 'EX', windowSeconds, 'NX')) === 'OK')
          return {
            granted: true,
            release: async () => {
              await redis.eval(releaseScript, 1, key, token)
            },
          }
        const ttl = await redis.pttl(key)
        // -2: expired between both commands, so the slot is free again; try once more.
        if (ttl !== -2) return { granted: false, retryInMs: ttl > 0 ? ttl : windowSeconds * 1000 }
      }
      return { granted: false, retryInMs: windowSeconds * 1000 }
    },
  }
}
