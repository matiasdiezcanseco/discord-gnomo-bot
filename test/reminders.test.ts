import assert from 'node:assert/strict'
import { test } from 'node:test'
import Redis from 'ioredis'
import { randomUUID } from 'node:crypto'
import { createConversation } from '../src/conversation/harness'
import { pilotCatalog } from '../src/conversation/pilot-catalog'
import { ScheduledNotices } from '../src/conversation/scheduled-notices'
import { NoticeFailure } from '../src/conversation/scheduled-notices'
import { composePilot } from '../src/modules/discord/pilot-conversation'
import { discordScheduledDelivery } from '../src/modules/discord/scheduled-delivery'
import { ConfigService } from '@nestjs/config'
import type { Client } from 'discord.js'
import { transferLegacyReminders } from '../src/conversation/legacy-reminder-transfer'
import { ReminderCheckTask } from '../src/modules/schedule/reminder-check.task'
import type { DiscordService } from '../src/modules/discord/discord.service'
import type { ReminderService } from '../src/modules/services/reminder/reminder.service'
import type { LoggerService } from '../src/modules/services/logger/logger.service'
import { execFileSync } from 'node:child_process'

const origin = {
  messageId: 'm',
  guildId: 'g',
  channelId: 'c',
  requester: { id: 'u', username: 'Ana' },
  content: 'recuérdame en 2 minutos tomar agua',
  createdAt: Date.parse('2026-11-05T15:00:00Z'),
  attachments: [],
}
test('explicit tomorrow with 24-hour time is interpreted in Lima without a model parsing loop', { skip: !process.env.T02_REDIS_URL }, async () => {
  const redis = new Redis(process.env.T02_REDIS_URL!)
  const replies: string[] = []
  try {
    const app = createConversation({ catalog: pilotCatalog(undefined, undefined, undefined, undefined, undefined, new ScheduledNotices(redis, `test:t12:${randomUUID()}`)), authorize: async () => true, claim: async () => true, model: { generate: async () => { throw Error('no model') } }, reply: async (_, r) => { replies.push(r.content) } })
    await app.handle({ ...origin, content: 'recuérdame mañana a las 08:00 tomar agua' })
    assert.match(replies[0], /guardado para 2026-11-06 08:00 America\/Lima/)
  } finally { await redis.quit() }
})
test(
  'own request is saved before confirmation and delivered once after client recreation by competing dispatchers',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const ns = `test:t12:${randomUUID()}`
    const replies: string[] = [],
      sent: unknown[] = []
    const store = new ScheduledNotices(redis, ns)
    const app = createConversation({
      catalog: pilotCatalog(undefined, undefined, undefined, undefined, undefined, store),
      authorize: async () => true,
      claim: async () => true,
      model: {
        generate: async () => {
          throw Error('direct request needs no model')
        },
      },
      reply: async (_, r) => {
        replies.push(r.content)
      },
    })
    try {
      await app.handle(origin)
      assert.match(replies[0], /guardado/i)
      await app.handle(origin)
      await redis.quit()
      const second = new Redis(process.env.T02_REDIS_URL!)
      try {
        const a = new ScheduledNotices(second, ns),
          b = new ScheduledNotices(second, ns)
        const delivery = {
          authorize: async () => true,
          send: async (_: unknown, reply: unknown) => {
            sent.push(reply)
          },
        }
        await Promise.all([
          a.dispatch(origin.createdAt + 120000, delivery),
          b.dispatch(origin.createdAt + 120000, delivery),
        ])
        assert.equal(sent.length, 1)
        assert.deepEqual(sent[0], {
          content: '<@u> ¡Recordatorio! tomar agua',
          allowedMentions: { parse: [], users: ['u'], roles: [], repliedUser: false },
        })
      } finally {
        await second.quit()
      }
    } finally {
      redis.disconnect()
    }
  },
)

test(
  'ambiguous times clarify without saving; external model instructions cannot create a reminder',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const store = new ScheduledNotices(redis, `test:t12:${randomUUID()}`)
    const replies: string[] = [],
      sent: unknown[] = []
    const app = createConversation({
      catalog: pilotCatalog(undefined, undefined, undefined, undefined, undefined, store),
      authorize: async () => true,
      claim: async () => true,
      model: {
        generate: async ({ results }) =>
          results.length
            ? { text: JSON.stringify(results), calls: [] }
            : { text: '', calls: [{ id: 'injected', name: 'reminder_create', input: {} }] },
      },
      reply: async (_, r) => {
        replies.push(r.content)
      },
    })
    try {
      await app.handle({ ...origin, content: 'recuérdame mañana a las 8 tomar agua' })
      assert.match(replies[0], /fecha y hora exactas/)
      await app.handle({ ...origin, content: 'lee esta página' })
      await store.dispatch(origin.createdAt + 86400000, {
        authorize: async () => true,
        send: async (_, r) => {
          sent.push(r)
        },
      })
      assert.deepEqual(sent, [])
    } finally {
      await redis.quit()
    }
  },
)

test(
  'delivery failures are retained diagnostically, retry only proven rejection, and sending crash is uncertain',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const store = new ScheduledNotices(redis, `test:t12:${randomUUID()}`)
    try {
      const record = await store.save(origin, 'agua', 10)
      let calls = 0
      const delivery = {
        authorize: async () => true,
        send: async () => {
          calls++
          throw new NoticeFailure('transient', '429 rejected')
        },
      }
      await store.dispatch(10, delivery)
      assert.equal((await store.get(record.id))?.state, 'pending')
      await store.dispatch(60010, delivery)
      await store.dispatch(180010, delivery)
      assert.equal(calls, 3)
      assert.equal((await store.get(record.id))?.state, 'dead')
      const denied = await store.save({ ...origin, messageId: 'denied' }, 'agua', 10)
      await store.dispatch(10, { authorize: async () => false, send: delivery.send })
      assert.equal((await store.get(denied.id))?.state, 'dead')
      const unknown = await store.save({ ...origin, messageId: 'unknown' }, 'agua', 10)
      await store.dispatch(10, {
        authorize: async () => true,
        send: async () => {
          throw Error('socket timeout')
        },
      })
      await store.dispatch(999999, delivery)
      assert.equal((await store.get(unknown.id))?.state, 'uncertain')
      assert.equal(calls, 3)
    } finally {
      await redis.quit()
    }
  },
)

test(
  'real pilot composition confirms Lima date, scheduled thread delivery revalidates permissions and guild',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    let allowed = true
    const sent: unknown[] = [],
      replies: string[] = []
    const channel = {
      isTextBased: () => true,
      isSendable: () => true,
      isThread: () => true,
      archived: false,
      locked: false,
      permissionsFor: () => ({ has: () => allowed }),
      send: async (reply: unknown) => {
        sent.push(reply)
      },
    }
    const client = {
      user: { id: 'bot' },
      guilds: {
        fetch: async () => ({
          channels: { fetch: async () => channel },
          members: { fetch: async () => ({ id: 'u' }) },
        }),
      },
    } as unknown as Client
    const config = new ConfigService({ GUILD_ID: 'g', CONVERSATION_PILOT_CHANNEL_IDS: 'c' })
    const app = composePilot(client, config, redis, undefined, {
      generate: async () => {
        throw Error('no model for reminder')
      },
    })
    const store = new ScheduledNotices(redis)
    try {
      await app.handle(
        {
          ...origin,
          messageId: randomUUID(),
          content: 'recuérdame 2026-11-06 a las 08:00 tomar agua',
        },
        async (_, r) => {
          replies.push(r.content)
        },
      )
      assert.match(replies[0], /2026-11-06 08:00 America\/Lima/)
      allowed = false
      await store.dispatch(
        Date.parse('2026-11-06T13:00:00Z'),
        discordScheduledDelivery(client, config),
      )
      assert.equal(sent.length, 0)
      assert.equal(
        await discordScheduledDelivery(client, config).authorize({ ...origin, guildId: 'other' }),
        false,
      )
      allowed = true
      await app.handle({ ...origin, messageId: randomUUID() }, async () => {})
      await store.dispatch(origin.createdAt + 120000, discordScheduledDelivery(client, config))
      assert.equal(sent.length, 1)
    } finally {
      await redis.quit()
    }
  },
)

test(
  'explicit legacy transfer preserves raw pending data and legacy cron cannot send pilot notices',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const id = randomUUID(),
      other = randomUUID()
    const reminder = {
      id,
      userId: '123',
      username: 'Ana',
      channelId: 'pilot',
      message: 'agua',
      dueTime: 10,
      createdAt: 0,
    }
    const ns = `test:t12:${randomUUID()}`
    let sent = 0
    try {
      await redis.set(`reminder:${id}`, JSON.stringify(reminder))
      await redis.zadd('reminders:due', 10, id)
      await redis.set(
        `reminder:${other}`,
        JSON.stringify({ ...reminder, id: other, channelId: 'nonpilot' }),
      )
      await redis.zadd('reminders:due', 10, other)
      const task = new ReminderCheckTask(
        {
          getClient: () => ({
            channels: {
              cache: {
                get: () => {
                  sent++
                  return null
                },
              },
            },
          }),
        } as unknown as DiscordService,
        {
          getDueReminders: async () => [reminder],
          deleteReminder: async () => {
            throw Error('must retain pilot')
          },
        } as unknown as ReminderService,
        new ConfigService({ CONVERSATION_PILOT_CHANNEL_IDS: 'pilot' }),
        { createLogger: () => ({ info() {}, warn() {}, error() {} }) } as unknown as LoggerService,
      )
      await task.handleReminderCheck()
      assert.equal(sent, 0)
      const options = {
        guildId: 'g',
        pilotChannels: ['pilot'],
        channelGuild: async () => 'wrong',
        namespace: ns,
      }
      assert.equal(
        (await transferLegacyReminders(redis, options)).find((r) => r.id === id)?.outcome,
        'retained',
      )
      options.channelGuild = async () => 'g'
      await transferLegacyReminders(redis, options)
      await transferLegacyReminders(redis, options)
      assert.ok(await redis.get(`reminder:${id}`))
      assert.ok(await redis.zscore('reminders:due', other))
      await new ScheduledNotices(redis, ns).dispatch(10, {
        authorize: async () => true,
        send: async () => {
          sent++
        },
      })
      assert.equal(sent, 1)
    } finally {
      await redis.zrem('reminders:due', id, other)
      await redis.del(`reminder:${id}`, `reminder:${other}`)
      await redis.quit()
    }
  },
)

test(
  'real Redis write timeout reports uncertain and eventual save remains deduplicated',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const control = new Redis(process.env.T02_REDIS_URL!)
    const writer = new Redis(process.env.T02_REDIS_URL!, {
      lazyConnect: true,
      commandTimeout: 40,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    })
    const ns = `test:t12:${randomUUID()}`,
      replies: string[] = []
    try {
      await writer.connect()
      await control.call('CLIENT', 'PAUSE', '200', 'WRITE')
      const app = createConversation({
        catalog: pilotCatalog(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          new ScheduledNotices(writer, ns),
        ),
        authorize: async () => true,
        claim: async () => true,
        model: {
          generate: async () => {
            throw Error('no model')
          },
        },
        reply: async (_, r) => {
          replies.push(r.content)
        },
      })
      await app.handle(origin)
      assert.match(replies[0], /incierto/)
      assert.doesNotMatch(replies[0], /guardado para/)
      await new Promise((resolve) => setTimeout(resolve, 250))
      let count = 0
      const store = new ScheduledNotices(control, ns)
      await store.save(origin, 'tomar agua', origin.createdAt + 120000)
      await store.dispatch(origin.createdAt + 120000, {
        authorize: async () => true,
        send: async () => {
          count++
        },
      })
      assert.equal(count, 1)
    } finally {
      writer.disconnect()
      await control.quit()
    }
  },
)

test(
  'expired sending lease is uncertain and never resent even when original worker returns',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const store = new ScheduledNotices(redis, `test:t12:${randomUUID()}`)
    let began!: () => void, finish!: () => void
    const started = new Promise<void>((r) => {
        began = r
      }),
      gate = new Promise<void>((r) => {
        finish = r
      })
    try {
      const record = await store.save(origin, 'agua', 10)
      const first = store.dispatch(10, {
        authorize: async () => true,
        send: async () => {
          began()
          await gate
        },
      })
      await started
      await store.dispatch(30011, {
        authorize: async () => true,
        send: async () => {
          assert.fail('blind retry')
        },
      })
      assert.equal((await store.get(record.id))?.state, 'uncertain')
      finish()
      await first
      assert.equal((await store.get(record.id))?.state, 'uncertain')
    } finally {
      finish?.()
      await redis.quit()
    }
  },
)

test(
  'confirmed reminder survives actual isolated AOF Redis server restart',
  { skip: !process.env.T12_REDIS_RESTART_URL || !process.env.T12_REDIS_CONTAINER },
  async () => {
    const url = process.env.T12_REDIS_RESTART_URL!
    const redis = new Redis(url)
    const ns = `test:t12:restart:${randomUUID()}`
    const replies: string[] = []
    const app = createConversation({
      catalog: pilotCatalog(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        new ScheduledNotices(redis, ns),
      ),
      authorize: async () => true,
      claim: async () => true,
      model: {
        generate: async () => {
          throw Error('no model')
        },
      },
      reply: async (_, r) => {
        replies.push(r.content)
      },
    })
    await app.handle(origin)
    assert.match(replies[0], /guardado/)
    await redis.quit()
    execFileSync('docker', ['restart', process.env.T12_REDIS_CONTAINER!], { timeout: 30000 })
    const restarted = new Redis(url)
    try {
      let delivered = 0
      await new ScheduledNotices(restarted, ns).dispatch(origin.createdAt + 120000, {
        authorize: async () => true,
        send: async () => {
          delivered++
        },
      })
      assert.equal(delivered, 1)
    } finally {
      await restarted.quit()
    }
  },
)
