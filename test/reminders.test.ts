import assert from 'node:assert/strict'
import { test } from 'node:test'
import Redis from 'ioredis'
import { randomUUID } from 'node:crypto'
import { createConversation, type ModelInput } from '../src/conversation/harness'
import { composeCapabilities } from '../src/conversation/capabilities'
import { ScheduledNotices, type ScheduledOrigin } from '../src/conversation/scheduled-notices'
import { NoticeFailure } from '../src/conversation/scheduled-notices'
import { composeConversation } from '../src/modules/discord/conversation-composition'
import { discordScheduledDelivery } from '../src/modules/discord/scheduled-delivery'
import { ConfigService } from '@nestjs/config'
import type { Client } from 'discord.js'
import { transferLegacyReminders } from '../src/conversation/legacy-reminder-transfer'
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
/** Stands in for the LLM: it decides the intent and supplies the time, as in production. */
function planned(plan: Record<string, unknown>) {
  return {
    generate: async ({ invocation, results }: ModelInput) => {
      if (results.length)
        return { text: (results[0].value as { message?: string })?.message ?? '', calls: [] }
      const input = plan[invocation.content]
      return input
        ? { text: '', calls: [{ id: 'r', name: 'reminder_create', input }] }
        : { text: 'Ok.', calls: [] }
    },
  }
}
const inTwoMinutes = { dueAt: '2026-11-05T10:02:00-05:00', text: 'tomar agua' }
test(
  'model-chosen times are stored and confirmed in Lima time',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const replies: string[] = []
    try {
      const app = createConversation({
        catalog: composeCapabilities({
          notices: new ScheduledNotices(redis, `test:t12:${randomUUID()}`),
        }),
        authorize: async () => true,
        claim: async () => true,
        model: planned({
          'recuérdame mañana a las 08:00 tomar agua': {
            dueAt: '2026-11-06T08:00:00-05:00',
            text: 'tomar agua',
          },
          'recuérdame mañana a las 9am tomar agua': {
            dueAt: '2026-11-06 09:00',
            text: 'tomar agua',
          },
          'crea un recordatorio para almorzar mañana 12:30pm': {
            dueAt: '2026-11-06T12:30:00-05:00',
            text: 'almorzar',
          },
        }),
        reply: async (_, r) => {
          replies.push(r.content)
        },
      })
      await app.handle({ ...origin, content: 'recuérdame mañana a las 08:00 tomar agua' })
      assert.match(replies[0], /guardado para 2026-11-06 08:00 America\/Lima/)
      await app.handle({
        ...origin,
        messageId: 'am',
        content: 'recuérdame mañana a las 9am tomar agua',
      })
      assert.match(replies[1], /guardado para 2026-11-06 09:00 America\/Lima/)
      await app.handle({
        ...origin,
        messageId: 'pm',
        content: 'crea un recordatorio para almorzar mañana 12:30pm',
      })
      assert.match(replies[2], /guardado para 2026-11-06 12:30 America\/Lima/)
    } finally {
      await redis.quit()
    }
  },
)
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
      catalog: composeCapabilities({ notices: store }),
      authorize: async () => true,
      claim: async () => true,
      model: planned({ [origin.content]: inTwoMinutes }),
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
  'past, distant or malformed model times save nothing',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const store = new ScheduledNotices(redis, `test:t12:${randomUUID()}`)
    const replies: string[] = [],
      sent: unknown[] = []
    const app = createConversation({
      catalog: composeCapabilities({ notices: store }),
      authorize: async () => true,
      claim: async () => true,
      model: planned({
        'recuérdame ayer tomar agua': { dueAt: '2026-11-04T08:00:00-05:00', text: 'tomar agua' },
        'recuérdame en 5 años': { dueAt: '2031-11-05T08:00:00-05:00', text: 'algo' },
        'recuérdame algo': {},
      }),
      reply: async (_, r) => {
        replies.push(r.content)
      },
    })
    try {
      await app.handle({ ...origin, content: 'recuérdame ayer tomar agua' })
      assert.match(replies[0], /futura/)
      await app.handle({ ...origin, messageId: 'far', content: 'recuérdame en 5 años' })
      assert.match(replies[1], /futura/)
      await app.handle({ ...origin, messageId: 'bad', content: 'recuérdame algo' })
      assert.doesNotMatch(replies[2], /guardado/)
      await store.dispatch(Date.parse('2032-01-01T00:00:00Z'), {
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
    const config = new ConfigService({
      GUILD_ID: 'g',
      RUNTIME_MODE: 'pilot',
      RUNTIME_CHANNEL_IDS: 'c',
    })
    const app = composeConversation({
      client: client,
      config: config,
      redis: redis,
      model: planned({
        [origin.content]: inTwoMinutes,
        'recuérdame 2026-11-06 a las 08:00 tomar agua': {
          dueAt: '2026-11-06T08:00',
          text: 'tomar agua',
        },
      }),
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
  'explicit legacy transfer preserves raw pending data and repeated transfer delivers each eligible notice once',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const orphan = randomUUID()
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
      await redis.set(`reminder:${orphan}`, JSON.stringify({ ...reminder, id: orphan }))
      await redis.zadd('reminders:due', 10, id)
      await redis.set(
        `reminder:${other}`,
        JSON.stringify({ ...reminder, id: other, channelId: 'nonpilot' }),
      )
      await redis.zadd('reminders:due', 10, other)
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
      assert.equal(sent, 2)
    } finally {
      await redis.zrem('reminders:due', id, other)
      await redis.del(`reminder:${id}`, `reminder:${other}`, `reminder:${orphan}`)
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
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    })
    const ns = `test:t12:${randomUUID()}`,
      replies: string[] = []
    try {
      await writer.connect()
      await writer.ping()
      // Time out the write under test, not the connection handshake.
      writer.options.commandTimeout = 40
      await control.call('CLIENT', 'PAUSE', '60000', 'WRITE')
      const app = createConversation({
        catalog: composeCapabilities({ notices: new ScheduledNotices(writer, ns) }),
        authorize: async () => true,
        claim: async () => true,
        model: planned({ [origin.content]: inTwoMinutes }),
        reply: async (_, r) => {
          replies.push(r.content)
        },
      })
      await app.handle(origin)
      await control.call('CLIENT', 'UNPAUSE')
      assert.match(replies[0], /incierto/)
      assert.doesNotMatch(replies[0], /guardado para/)
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
      try {
        await control.call('CLIENT', 'UNPAUSE')
      } finally {
        writer.disconnect()
        await control.quit()
      }
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
      catalog: composeCapabilities({ notices: new ScheduledNotices(redis, ns) }),
      authorize: async () => true,
      claim: async () => true,
      model: planned({ [origin.content]: inTwoMinutes }),
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
test(
  'configuration rollback retains queued notices without consuming attempts and resumes one safe delivery',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const store = new ScheduledNotices(redis, `test:t15:${randomUUID()}`)
    const config = new ConfigService({
      GUILD_ID: 'g',
      RUNTIME_MODE: 'paused',
      RUNTIME_CHANNEL_IDS: 'c',
    })
    const sent: unknown[] = []
    const channel = {
      isTextBased: () => true,
      isSendable: () => true,
      isThread: () => false,
      permissionsFor: () => ({ has: () => true }),
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
    try {
      const notice = await store.save(origin, 'agua @everyone <@&123>', 10)
      const delivery = discordScheduledDelivery(client, config)
      await store.dispatch(10, delivery)
      assert.equal((await store.get(notice.id))?.state, 'pending')
      assert.equal((await store.get(notice.id))?.attempts, 0)
      config.set('RUNTIME_MODE', 'pilot')
      config.set('RUNTIME_CHANNEL_IDS', 'other')
      await store.dispatch(10, delivery)
      assert.equal((await store.get(notice.id))?.state, 'pending')
      config.set('RUNTIME_CHANNEL_IDS', 'c')
      await Promise.all([store.dispatch(10, delivery), store.dispatch(10, delivery)])
      assert.deepEqual(sent, [
        {
          content: '<@u> ¡Recordatorio! agua @everyone <@&123>',
          allowedMentions: { parse: [], users: ['u'], roles: [], repliedUser: false },
        },
      ])
      assert.equal((await store.get(notice.id))?.state, 'sent')
    } finally {
      await redis.quit()
    }
  },
)

test(
  'bounded dispatch advances beyond multiple excluded batches, including tied due scores and concurrent resume',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const ns = `test:review:${randomUUID()}`
    const store = new ScheduledNotices(redis, ns)
    const sent: string[] = []
    let admitted = 'c'
    const delivery = {
      admits: (o: { channelId: string }) => o.channelId === admitted,
      authorize: async () => true,
      send: async (o: ScheduledOrigin) => {
        if ('messageId' in o) sent.push(o.messageId)
      },
    }
    try {
      const excluded = await Promise.all(
        Array.from({ length: 125 }, (_, i) =>
          store.save({ ...origin, messageId: `excluded-${i}`, channelId: 'excluded' }, 'agua', 1),
        ),
      )
      const eligible = await store.save({ ...origin, messageId: 'later' }, 'agua', 2)
      for (let i = 0; i < 6; i++) await store.dispatch(10, delivery)
      assert.deepEqual(sent, ['later'])
      assert.equal((await store.get(eligible.id))?.state, 'sent')
      for (const record of excluded) assert.deepEqual(await store.get(record.id), record)
      // Recreate workers and change admission, with every old score tied.
      admitted = 'none'
      await new ScheduledNotices(redis, ns).dispatch(10, delivery)
      admitted = 'excluded'
      const other = new ScheduledNotices(redis, ns)
      for (let i = 0; i < 8; i++)
        await Promise.all([store.dispatch(10, delivery), other.dispatch(10, delivery)])
      assert.equal(sent.length, 126)
      assert.equal(new Set(sent).size, 126)
      for (const record of excluded) {
        assert.equal((await store.get(record.id))?.state, 'sent')
        assert.equal((await store.get(record.id))?.attempts, 1)
      }
    } finally {
      await redis.quit()
    }
  },
)

test(
  'equal-score notices beyond one page remain reachable after cursor recreation',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const ns = `test:review:tied:${randomUUID()}`
    const store = new ScheduledNotices(redis, ns)
    try {
      const records = await Promise.all(
        Array.from({ length: 160 }, (_, i) =>
          store.save({ ...origin, channelId: `scope-${i}`, messageId: `tied-${i}` }, 'agua', 10),
        ),
      )
      const last = records.sort((a, b) => a.id.localeCompare(b.id)).at(-1)!
      let sent = 0
      const delivery = {
        admits: (o: ScheduledOrigin) => o.channelId === last.origin.channelId,
        authorize: async () => true,
        send: async () => {
          sent++
        },
      }
      for (let i = 0; i < 8; i++) await new ScheduledNotices(redis, ns).dispatch(10, delivery)
      assert.equal(sent, 1)
      for (const record of records.slice(0, -1))
        assert.deepEqual(await store.get(record.id), record)
      assert.equal((await store.get(last.id))?.attempts, 1)
    } finally {
      await redis.quit()
    }
  },
)
