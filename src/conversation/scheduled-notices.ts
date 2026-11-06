import type Redis from 'ioredis'
import { createHash, randomUUID } from 'node:crypto'
import type { Invocation } from '../core/conversation/invocation'
import type { Reply } from './harness'

/** Trusted scheduler origin; never accepted by conversation capabilities. */
export interface BirthdayOrigin {
  kind: 'birthday'
  guildId: string
  channelId: string
  requester: { id: string; username: string }
  calendarDate: string
}
export type ScheduledOrigin = Invocation | BirthdayOrigin
export function isBirthday(origin: ScheduledOrigin): origin is BirthdayOrigin {
  return 'kind' in origin && origin.kind === 'birthday'
}

export interface ScheduledNotice {
  id: string
  origin: ScheduledOrigin
  text: string
  due: number
  state: 'pending' | 'leased' | 'sending' | 'sent' | 'uncertain' | 'dead'
  attempts: number
  token?: string
  diagnostic?: string
}
/** Only use transient for a proven rejection BEFORE Discord accepted a message. */
export class NoticeFailure extends Error {
  constructor(
    readonly kind: 'transient' | 'permanent' | 'uncertain',
    message: string,
  ) {
    super(message)
  }
}
export interface ScheduledDelivery {
  /** Deployment admission is separate from permission denial; excluded records stay pending. */
  admits?(origin: ScheduledOrigin): boolean
  authorize(origin: ScheduledOrigin): Promise<boolean>
  send(origin: ScheduledOrigin, reply: Reply): Promise<void>
}

/** Redis single-instance atomic transitions; no TTL on records or idempotency keys. */
export class ScheduledNotices {
  constructor(
    private readonly redis: Redis,
    readonly namespace = 'gnomo:notices:v1',
  ) {}
  private get records() {
    return `${this.namespace}:records`
  }
  private get due() {
    return `${this.namespace}:due`
  }
  async get(id: string): Promise<ScheduledNotice | null> {
    const value = await this.redis.hget(this.records, id)
    return value ? JSON.parse(value) : null
  }
  async save(origin: ScheduledOrigin, text: string, due: number, legacyId?: string) {
    const id = createHash('sha256')
      .update(
        isBirthday(origin)
          ? JSON.stringify([
              'birthday',
              origin.guildId,
              origin.channelId,
              origin.requester.id,
              origin.calendarDate,
            ])
          : legacyId
            ? `legacy:${legacyId}`
            : JSON.stringify([origin.guildId, origin.channelId, origin.messageId]),
      )
      .digest('hex')
    const record: ScheduledNotice = { id, origin, text, due, state: 'pending', attempts: 0 }
    const raw = await this.redis.eval(
      `
      local old = redis.call('HGET', KEYS[1], ARGV[1])
      if old then return old end
      redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
      redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
      return ARGV[2]`,
      2,
      this.records,
      this.due,
      id,
      JSON.stringify(record),
      due,
    )
    return JSON.parse(String(raw)) as ScheduledNotice
  }
  private async transition(
    id: string,
    token: string,
    state: ScheduledNotice['state'],
    diagnostic = '',
    retryAt = 0,
  ) {
    return (
      Number(
        await this.redis.eval(
          `
      local raw = redis.call('HGET', KEYS[1], ARGV[1]); if not raw then return 0 end
      local r = cjson.decode(raw)
      if r.token ~= ARGV[2] or (r.state ~= 'leased' and r.state ~= 'sending') then return 0 end
      r.state = ARGV[3]; r.diagnostic = ARGV[4]
      redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(r))
      if tonumber(ARGV[5]) > 0 then redis.call('ZADD', KEYS[2], ARGV[5], ARGV[1]) else redis.call('ZREM', KEYS[2], ARGV[1]) end
      return 1`,
          2,
          this.records,
          this.due,
          id,
          token,
          state,
          diagnostic,
          retryAt,
        ),
      ) === 1
    )
  }
  async dispatch(now: number, delivery: ScheduledDelivery) {
    const ids = await this.redis.zrangebyscore(this.due, '-inf', now, 'LIMIT', 0, 50)
    for (const id of ids) {
      if (delivery.admits) {
        const candidate = await this.get(id)
        if (!candidate || !delivery.admits(candidate.origin)) continue
      }
      const token = randomUUID()
      const raw = await this.redis.eval(
        `
        local raw = redis.call('HGET', KEYS[1], ARGV[1]); if not raw then return nil end
        local score = redis.call('ZSCORE', KEYS[2], ARGV[1]); if not score or tonumber(score) > tonumber(ARGV[2]) then return nil end
        local r = cjson.decode(raw)
        if r.state == 'sending' then
          r.state = 'uncertain'; r.diagnostic = 'sending lease expired; acceptance unknown'
          redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(r)); redis.call('ZREM', KEYS[2], ARGV[1]); return nil
        end
        if r.state ~= 'pending' and r.state ~= 'leased' then return nil end
        r.state = 'leased'; r.token = ARGV[3]; r.attempts = r.attempts + 1
        redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(r))
        redis.call('ZADD', KEYS[2], tonumber(ARGV[2]) + 30000, ARGV[1])
        return cjson.encode(r)`,
        2,
        this.records,
        this.due,
        id,
        now,
        token,
      )
      if (!raw) continue
      const record = JSON.parse(String(raw)) as ScheduledNotice
      try {
        if (record.attempts > 3) throw new NoticeFailure('permanent', 'attempt limit')
        if (!(await delivery.authorize(record.origin)))
          throw new NoticeFailure('permanent', 'permission revoked or origin unavailable')
        // A durable sending marker must succeed before the external effect. Fence stale workers.
        if (!(await this.transition(id, token, 'sending', '', now + 30000))) continue
        await delivery.send(record.origin, {
          content: isBirthday(record.origin)
            ? `<@${record.origin.requester.id}> Feliz cumpleaños ${record.text}! 🎉🎉🎉`
            : `<@${record.origin.requester.id}> ¡Recordatorio! ${record.text}`,
          allowedMentions: {
            parse: [],
            users: [record.origin.requester.id],
            roles: [],
            repliedUser: false,
          },
        })
        await this.transition(id, token, 'sent')
      } catch (error) {
        const kind = error instanceof NoticeFailure ? error.kind : 'uncertain'
        const retry = kind === 'transient' && record.attempts < 3
        await this.transition(
          id,
          token,
          retry ? 'pending' : kind === 'uncertain' ? 'uncertain' : 'dead',
          error instanceof NoticeFailure
            ? error.message
            : 'unclassified failure; acceptance unknown',
          retry ? now + 60000 * record.attempts : 0,
        )
      }
    }
  }
}
