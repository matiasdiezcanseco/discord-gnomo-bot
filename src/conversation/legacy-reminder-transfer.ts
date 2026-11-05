import type Redis from 'ioredis'
import type { Reminder } from '../modules/services/reminder/reminder.service'
import { ScheduledNotices } from './scheduled-notices'

/** Explicit operator operation, never startup work. Stop old-version workers before enabling pilot. */
export async function transferLegacyReminders(
  redis: Redis,
  options: {
    guildId: string
    pilotChannels: readonly string[]
    channelGuild(channelId: string): Promise<string | null>
    namespace?: string
  },
) {
  const store = new ScheduledNotices(redis, options.namespace)
  const report: { id: string; outcome: 'transferred' | 'retained' }[] = []
  const ids = new Set(await redis.zrange('reminders:due', 0, -1))
  // Old creation used SET then ZADD separately. Recover payloads whose index write failed.
  let cursor = '0'
  do {
    const page = await redis.scan(cursor, 'MATCH', 'reminder:*', 'COUNT', 100)
    cursor = page[0]
    for (const key of page[1]) ids.add(key.slice('reminder:'.length))
  } while (cursor !== '0')
  for (const id of ids) {
    const raw = await redis.get(`reminder:${id}`)
    let r: Reminder
    try {
      r = JSON.parse(raw ?? '')
    } catch {
      report.push({ id, outcome: 'retained' })
      continue
    }
    if (
      !r ||
      r.id !== id ||
      typeof r.channelId !== 'string' ||
      !options.pilotChannels.includes(r.channelId) ||
      !/^\d+$/.test(r.userId) ||
      typeof r.message !== 'string' ||
      r.message.length > 1000 ||
      !Number.isSafeInteger(r.dueTime) ||
      !Number.isSafeInteger(r.createdAt) ||
      (await options.channelGuild(r.channelId)) !== options.guildId
    ) {
      report.push({ id, outcome: 'retained' })
      continue
    }
    // Save first. A crash between operations leaves both records, but legacy pilot exclusion
    // prevents a competing send. Repeating this operation uses the same durable ID.
    await store.save(
      {
        guildId: options.guildId,
        channelId: r.channelId,
        messageId: `legacy:${id}`,
        requester: { id: r.userId, username: r.username },
        createdAt: r.createdAt,
        content: '',
        attachments: [],
      },
      r.message,
      r.dueTime,
      id,
    )
    // Compare original record before removing its index; preserve the raw legacy payload.
    await redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('ZREM', KEYS[2], ARGV[2]) end return 0`,
      2,
      `reminder:${id}`,
      'reminders:due',
      raw!,
      id,
    )
    report.push({ id, outcome: 'transferred' })
  }
  return report
}
