import type Redis from 'ioredis'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { Invocation } from '../core/conversation/invocation'
import { defineCapability } from './catalog'
import type { VoiceMetadata } from './voice-message'

dayjs.extend(utc)
dayjs.extend(timezone)

export type CooldownReservation =
  | { granted: true; release(): Promise<void> }
  | { granted: false; retryInMs: number }

/** One paid generation per requester per window. The slot is taken before spending any credit. */
export interface RequesterCooldown {
  reserve(invocation: Invocation): Promise<CooldownReservation>
}

// Deletes the slot only while it is still the one this reservation took.
const releaseScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`

/**
 * Atomic per-user cooldown shared by every process using the same Redis: `SET NX EX` either takes
 * the slot or reports how long until it frees. Redis failures propagate, so callers fail closed.
 */
export function redisCooldown(
  redis: Redis,
  windowSeconds: number,
  namespace: string,
): RequesterCooldown {
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1)
    throw new Error('Invalid cooldown window')
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

/** The provider refused the request outright (e.g. content policy): nothing was produced. */
export class GenerationRejected extends Error {}

export interface GeneratedFile {
  extension: string
  data: Buffer
  /** Present only for audio delivered as a Discord voice message. */
  voice?: VoiceMetadata
}

export interface PaidGeneration<I> {
  name: string
  description: string
  capability: string
  label: string
  input: z.ZodType<I>
  cooldown?: RequesterCooldown
  /**
   * One provider call that spends credits; absent when the provider is not configured. Throw
   * `GenerationRejected` when the provider refused without producing anything.
   */
  produce?: (input: I, signal: AbortSignal) => Promise<GeneratedFile>
  /** Everything the model is told; the rules below are the same for every paid capability. */
  words: {
    unavailable: string
    /** The cooldown store could not be reached, so nothing was spent. */
    unverified: string
    limited(retryInMinutes: number): string
    rejected: string
    created: string
  }
}

/**
 * A capability that spends provider credits, chosen by the model from intent and bounded by a
 * per-requester cooldown. The slot is taken before any credit is spent, and an unreachable
 * cooldown store fails closed. A refusal gives the slot back; any other failure keeps it, because
 * the credit may already be spent. The file never passes through the model: it is attached to
 * the reply.
 */
export function paidGeneration<I>({ cooldown, produce, words, ...identity }: PaidGeneration<I>) {
  return defineCapability({
    ...identity,
    scope: 'channel',
    effect: 'write',
    output: z.strictObject({
      status: z.enum(['created', 'rate_limited', 'rejected', 'unavailable']),
      message: z.string(),
      retryInMinutes: z.number().int().optional(),
      retryAt: z.string().optional(),
    }),
    maxCalls: 1,
    maxResultChars: 1000,
    available: async () => !!produce && !!cooldown,
    execute: async (input, context) => {
      if (!produce || !cooldown || !context.attach)
        return { status: 'unavailable' as const, message: words.unavailable }
      context.signal.throwIfAborted()
      let reservation: CooldownReservation
      try {
        reservation = await context.external(() => cooldown.reserve(context.invocation))
      } catch {
        return { status: 'unavailable' as const, message: words.unverified }
      }
      if (!reservation.granted) {
        const retryInMinutes = Math.max(1, Math.ceil(reservation.retryInMs / 60000))
        return {
          status: 'rate_limited' as const,
          message: words.limited(retryInMinutes),
          retryInMinutes,
          retryAt: dayjs(Date.now() + reservation.retryInMs)
            .tz('America/Lima')
            .format('HH:mm'),
        }
      }
      let file: GeneratedFile
      try {
        file = await context.external(() => produce(input, context.signal))
      } catch (error) {
        if (!(error instanceof GenerationRejected)) throw error
        await reservation.release().catch(() => undefined)
        return { status: 'rejected' as const, message: words.rejected }
      }
      context.attach({
        name: `gnomo-${context.invocation.messageId}.${file.extension}`,
        attachment: file.data,
        ...(file.voice ? { voice: file.voice } : {}),
      })
      return { status: 'created' as const, message: words.created }
    },
  })
}
