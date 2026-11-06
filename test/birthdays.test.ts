import assert from 'node:assert/strict'
import { test } from 'node:test'
import Redis from 'ioredis'
import { randomUUID } from 'node:crypto'
import { scheduleBirthdays } from '../src/conversation/birthdays'
import { ScheduledNotices } from '../src/conversation/scheduled-notices'

const birthday = { id: '123456789012345678', name: 'Ana', date: '11-05' }
const destination = { guildId: '123456789012345679', channelId: '123456789012345680' }
test(
  'Lima birthday event publishes once across duplicate source records and competing workers',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const a = new Redis(process.env.T02_REDIS_URL!)
    const b = new Redis(process.env.T02_REDIS_URL!)
    const ns = `test:t13:${randomUUID()}`
    const first = new ScheduledNotices(a, ns),
      second = new ScheduledNotices(b, ns)
    const now = Date.parse('2026-11-05T13:00:00Z')
    const sent: unknown[] = []
    try {
      await Promise.all(
        [first, second].map((store) =>
          scheduleBirthdays(now, destination, async () => [birthday, birthday], store),
        ),
      )
      const delivery = {
        authorize: async () => true,
        send: async (_: unknown, reply: unknown) => {
          sent.push(reply)
        },
      }
      await Promise.all([first.dispatch(now, delivery), second.dispatch(now, delivery)])
      assert.deepEqual(sent, [
        {
          content: '<@123456789012345678> Feliz cumpleaños Ana! 🎉🎉🎉',
          allowedMentions: { parse: [], users: [birthday.id], roles: [], repliedUser: false },
        },
      ])
    } finally {
      await a.quit()
      await b.quit()
    }
  },
)

import type { ConfigService } from '@nestjs/config'
import type { Client } from 'discord.js'
import { discordScheduledDelivery } from '../src/modules/discord/scheduled-delivery'

function discordFixture() {
  const sent: unknown[] = []
  let permitted = true
  let failure: number | undefined
  const channel = {
    type: 0,
    guildId: destination.guildId,
    isTextBased: () => true,
    isSendable: () => true,
    isThread: () => false,
    permissionsFor: () => ({ has: () => permitted }),
    send: async (reply: unknown) => {
      if (failure) throw { status: failure }
      sent.push(reply)
    },
  }
  const client = {
    user: { id: 'bot' },
    guilds: {
      fetch: async () => ({
        channels: { fetch: async () => channel },
        members: { fetch: async () => ({ id: birthday.id }) },
      }),
    },
  } as unknown as Client
  const values: Record<string, string> = {
    GUILD_ID: destination.guildId,
    GNOMOS_CHANNEL_ID: destination.channelId,
  }
  const config = { get: (key: string) => values[key] } as ConfigService
  return {
    sent,
    client,
    config,
    revoke: () => {
      permitted = false
    },
    fail: (status?: number) => {
      failure = status
    },
  }
}

test(
  'birthday delivery revalidates source and configured destination before publication',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const store = new ScheduledNotices(redis, `test:t13:${randomUUID()}`)
    const now = Date.parse('2026-11-05T13:00:00Z')
    const fixture = discordFixture()
    let source: unknown = [birthday]
    try {
      const [record] = await scheduleBirthdays(now, destination, async () => source, store)
      source = []
      await store.dispatch(
        now,
        discordScheduledDelivery(
          fixture.client,
          fixture.config,
          async () => source,
          () => now,
        ),
      )
      assert.equal(fixture.sent.length, 0)
      assert.equal((await store.get(record.id))?.state, 'dead')
    } finally {
      await redis.quit()
    }
  },
)

test(
  'Lima midnight, 08:00, year boundaries and leap day preserve calendar identities',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const store = new ScheduledNotices(redis, `test:t13:${randomUUID()}`)
    let source: unknown = [
      { ...birthday, date: '12-31' },
      { ...birthday, date: '01-01' },
    ]
    const sent: unknown[] = []
    const delivery = {
      authorize: async () => true,
      send: async (_: unknown, reply: unknown) => {
        sent.push(reply)
      },
    }
    try {
      const [dec] = await scheduleBirthdays(
        Date.parse('2027-01-01T04:59:59Z'),
        destination,
        async () => source,
        store,
      )
      assert.equal('calendarDate' in dec.origin && dec.origin.calendarDate, '2026-12-31')
      const [jan] = await scheduleBirthdays(
        Date.parse('2027-01-01T05:00:00Z'),
        destination,
        async () => source,
        store,
      )
      assert.equal('calendarDate' in jan.origin && jan.origin.calendarDate, '2027-01-01')
      assert.notEqual(dec.id, jan.id)
      // Dispatch the previous day to clear it, then assert the January notice waits until 08:00.
      await store.dispatch(Date.parse('2027-01-01T04:59:59Z'), delivery)
      sent.length = 0
      await store.dispatch(Date.parse('2027-01-01T12:59:59Z'), delivery)
      assert.equal(sent.length, 0)
      await store.dispatch(Date.parse('2027-01-01T13:00:00Z'), delivery)
      assert.equal(sent.length, 1)
      source = [{ ...birthday, date: '02-29' }]
      assert.equal(
        (
          await scheduleBirthdays(
            Date.parse('2027-02-28T13:00:00Z'),
            destination,
            async () => source,
            store,
          )
        ).length,
        0,
      )
      assert.equal(
        (
          await scheduleBirthdays(
            Date.parse('2028-02-29T13:00:00Z'),
            destination,
            async () => source,
            store,
          )
        ).length,
        1,
      )
    } finally {
      await redis.quit()
    }
  },
)

test(
  'missing, empty, failed and malformed sources cannot create greetings or redirect mentions',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const store = new ScheduledNotices(redis, `test:t13:${randomUUID()}`)
    const now = Date.parse('2026-11-05T13:00:00Z')
    try {
      for (const data of [
        null,
        [],
        {},
        [{ ...birthday, id: '@everyone' }],
        [{ ...birthday, date: '11-31' }],
        [{ ...birthday, name: '' }],
      ])
        assert.deepEqual(await scheduleBirthdays(now, destination, async () => data, store), [])
      await assert.rejects(
        scheduleBirthdays(
          now,
          destination,
          async () => {
            throw Error('source down')
          },
          store,
        ),
      )
      assert.deepEqual(
        await scheduleBirthdays(
          now,
          { ...destination, guildId: '' },
          async () => [birthday],
          store,
        ),
        [],
      )
      const fixture = discordFixture()
      const source = [
        {
          ...birthday,
          name: '@everyone @here <@&123> <@999>',
          channelId: 'foreign',
          guildId: 'foreign',
        },
      ]
      await scheduleBirthdays(now, destination, async () => source, store)
      await store.dispatch(
        now,
        discordScheduledDelivery(
          fixture.client,
          fixture.config,
          async () => source,
          () => now,
        ),
      )
      assert.equal(fixture.sent.length, 1)
      assert.doesNotMatch(JSON.stringify(fixture.sent), /@everyone|@here|<@&|<@999>/)
    } finally {
      await redis.quit()
    }
  },
)

test(
  'birthday retry, permission revocation, destination changes and uncertain acceptance use shared terminal rules',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const now = Date.parse('2026-11-05T13:00:00Z')
    try {
      for (const mode of [
        'transient',
        'permanent',
        'uncertain',
        'revoked',
        'destination',
        'expired',
        'source-down',
        'second-check',
      ] as const) {
        const store = new ScheduledNotices(redis, `test:t13:${randomUUID()}`)
        const fixture = discordFixture()
        let checks = 0
        const source = async () => {
          checks++
          if (mode === 'second-check' && checks === 2) fixture.revoke()
          return mode === 'source-down' ? null : [birthday]
        }
        const [record] = await scheduleBirthdays(now, destination, async () => [birthday], store)
        if (mode === 'revoked') fixture.revoke()
        if (mode === 'destination') fixture.config.get = () => 'foreign'
        if (mode === 'transient') fixture.fail(429)
        if (mode === 'permanent') fixture.fail(403)
        if (mode === 'uncertain') fixture.fail(500)
        const delivery = discordScheduledDelivery(fixture.client, fixture.config, source, () =>
          mode === 'expired' ? now + 86400000 : now,
        )
        await store.dispatch(now, delivery)
        const state = (await store.get(record.id))?.state
        assert.equal(
          state,
          mode === 'transient' || mode === 'source-down'
            ? 'pending'
            : mode === 'uncertain'
              ? 'uncertain'
              : 'dead',
          mode,
        )
        fixture.fail()
        await store.dispatch(now + 60000, delivery)
        await store.dispatch(now + 180000, delivery)
        assert.equal(fixture.sent.length, mode === 'transient' ? 1 : 0, mode)
        if (mode === 'source-down') assert.equal((await store.get(record.id))?.state, 'dead')
      }
    } finally {
      await redis.quit()
    }
  },
)

import { execFileSync } from 'node:child_process'
import { BirthdayCheckTask } from '../src/modules/schedule/birthday-check.task'
import { ReliableNoticesTask } from '../src/modules/schedule/reliable-notices.task'
import type { DiscordService } from '../src/modules/discord/discord.service'
import type { BucketService } from '../src/modules/services/bucket/bucket.service'
import type { LoggerService } from '../src/modules/services/logger/logger.service'

test(
  'sole runtime birthday producer preserves nonpilot group greetings through the shared dispatcher',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const fixture = discordFixture()
    const now = Date.now()
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    const source = [{ ...birthday, date }]
    const bucket = { fetchBucketData: async () => source } as unknown as BucketService
    const discord = {
      isReady: () => true,
      getClient: () => fixture.client,
    } as unknown as DiscordService
    const logger = { error: () => assert.fail('runtime failed') } as unknown as LoggerService
    // Random configured channel ensures the production namespace cannot share another test's identity.
    const channelId = String(
      BigInt('123456789012345680') + BigInt(Math.floor(Math.random() * 100000000)),
    )
    fixture.config.get = ((key: string) =>
      key === 'GNOMOS_CHANNEL_ID'
        ? channelId
        : key === 'GUILD_ID'
          ? destination.guildId
          : undefined) as ConfigService['get']
    try {
      const producer = new BirthdayCheckTask(discord, bucket, fixture.config, logger, redis)
      await producer.handleBirthdayCheck(now)
      await producer.handleBirthdayCheck(now)
      const dispatcher = new ReliableNoticesTask(redis, discord, fixture.config, logger, bucket)
      await dispatcher.dispatch()
      const hour = Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'America/Lima',
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(now),
      )
      assert.equal(fixture.sent.length, hour >= 8 ? 1 : 0)
    } finally {
      await redis.quit()
    }
  },
)

test(
  'birthday survives real AOF restart without duplicate greetings after source replay',
  { skip: !process.env.T13_REDIS_RESTART_URL || !process.env.T13_REDIS_CONTAINER },
  async () => {
    const url = process.env.T13_REDIS_RESTART_URL!
    const ns = `test:t13:restart:${randomUUID()}`
    const now = Date.parse('2026-11-05T13:00:00Z')
    let redis = new Redis(url)
    const [record] = await scheduleBirthdays(
      now,
      destination,
      async () => [birthday],
      new ScheduledNotices(redis, ns),
    )
    await redis.quit()
    execFileSync('docker', ['restart', process.env.T13_REDIS_CONTAINER!], { timeout: 30000 })
    redis = new Redis(url)
    try {
      const fixture = discordFixture()
      const store = new ScheduledNotices(redis, ns)
      assert.equal((await store.get(record.id))?.state, 'pending')
      await scheduleBirthdays(now, destination, async () => [birthday, birthday], store)
      const delivery = discordScheduledDelivery(
        fixture.client,
        fixture.config,
        async () => [birthday],
        () => now,
      )
      await store.dispatch(now, delivery)
      await redis.quit()
      redis = new Redis(url)
      await scheduleBirthdays(
        now,
        destination,
        async () => [birthday],
        new ScheduledNotices(redis, ns),
      )
      await new ScheduledNotices(redis, ns).dispatch(now, delivery)
      assert.equal(fixture.sent.length, 1)
      assert.equal((await new ScheduledNotices(redis, ns).get(record.id))?.state, 'sent')
    } finally {
      await redis.quit()
    }
  },
)

import { createConversation } from '../src/conversation/harness'
import { pilotCatalog } from '../src/conversation/pilot-catalog'

test(
  'conversation/model cannot request a birthday recipient or arbitrary destination',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const store = new ScheduledNotices(redis, `test:t13:${randomUUID()}`)
    const replies: unknown[] = [],
      sent: unknown[] = []
    const app = createConversation({
      catalog: pilotCatalog(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        store,
      ),
      claim: async () => true,
      authorize: async () => true,
      model: {
        generate: async ({ results }) =>
          results.length
            ? { text: 'Sin anuncio', calls: [] }
            : {
                text: '',
                calls: [
                  {
                    id: 'birthday',
                    name: 'birthday_create',
                    input: { memberId: birthday.id, channelId: 'foreign' },
                  },
                  {
                    id: 'forged',
                    name: 'reminder_create',
                    input: { kind: 'birthday', recipient: birthday.id },
                  },
                ],
              },
      },
      reply: async (_, reply) => {
        replies.push(reply)
      },
    })
    try {
      await app.handle({
        messageId: 'request',
        ...destination,
        requester: { id: '999', username: 'Other' },
        content: 'felicita a Ana en otro canal',
        createdAt: Date.parse('2026-11-05T13:00:00Z'),
        attachments: [],
      })
      await store.dispatch(Date.parse('2027-11-05T13:00:00Z'), {
        authorize: async () => true,
        send: async (_, reply) => {
          sent.push(reply)
        },
      })
      assert.equal(replies.length, 1)
      assert.deepEqual(sent, [])
    } finally {
      await redis.quit()
    }
  },
)
