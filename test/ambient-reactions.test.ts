import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { ConfigService } from '@nestjs/config'
import pino from 'pino'
import type { Client, Message } from 'discord.js'
import {
  ambientReactions,
  redisReactionCountdown,
  resolveEmoji,
  type AmbientMessage,
} from '../src/conversation/ambient-reactions'
import { discordAmbientReactions } from '../src/modules/discord/ambient-reactions'
import { MessageHandlerService } from '../src/modules/discord/message-handler.service'
import { LoggerService } from '../src/modules/services/logger/logger.service'
import type { DiscordService } from '../src/modules/discord/discord.service'

/** In-memory stand-in that runs the countdown script's logic on GET/SET semantics. */
function fakeRedis() {
  const store = new Map<string, string>()
  const redis = {
    store,
    eval: async (_script: string, _keys: number, key: string, initial: number, rearm: number) => {
      const value = Number(store.get(key) ?? initial) - 1
      if (value <= 0) {
        store.set(key, String(rearm))
        return 1
      }
      store.set(key, String(value))
      return 0
    },
  }
  return redis as unknown as Redis & { store: Map<string, string> }
}

const custom = [
  { emoji: 'gnomo_risa:123', name: 'gnomo_risa' },
  { emoji: 'gnomo_triste:124', name: 'gnomo_triste' },
]

function message(overrides: Partial<AmbientMessage> = {}): AmbientMessage {
  return {
    guildId: 'g',
    channelId: '10',
    messageId: '900',
    requester: { id: 'u', username: 'Ana' },
    createdAt: 0,
    content: 'jajaja no puede ser',
    ...overrides,
  }
}

test('countdown reacts on the drawn message, then re-arms within 8-16', async () => {
  // Every tick draws (initial, re-arm): the first initial is 8, every later draw is 16.
  let calls = 0
  const countdown = redisReactionCountdown(fakeRedis(), () => (calls++ === 0 ? 0 : 0.999))
  const ticks: boolean[] = []
  for (let index = 0; index < 8; index++) ticks.push(await countdown.tick('g', '10'))
  assert.deepEqual(ticks, [...Array(7).fill(false), true])
  // Re-armed at 16: 15 quiet messages, then a reaction.
  const next: boolean[] = []
  for (let index = 0; index < 16; index++) next.push(await countdown.tick('g', '10'))
  assert.equal(next.indexOf(true), 15)
})

test('countdown is per channel and every gap stays within 8-16', async () => {
  const redis = fakeRedis()
  const countdown = redisReactionCountdown(redis)
  for (let round = 0; round < 50; round++) {
    let gap = 0
    while (!(await countdown.tick('g', '10'))) gap++
    assert.ok(gap + 1 >= 8 && gap + 1 <= 16, `gap ${gap + 1}`)
  }
  assert.deepEqual(
    [...redis.store.keys()].sort(),
    ['gnomo:ambient-reaction:v1:g:10'],
    'one key per channel',
  )
  await countdown.tick('g', '11')
  assert.equal(redis.store.size, 2)
})

test('custom emoji names map to name:id; standard emojis pass; anything else is dropped', () => {
  assert.equal(resolveEmoji('gnomo_risa', custom), 'gnomo_risa:123')
  assert.equal(resolveEmoji(':gnomo_risa:', custom), 'gnomo_risa:123')
  assert.equal(resolveEmoji('<:gnomo_triste:124>', custom), 'gnomo_triste:124')
  assert.equal(resolveEmoji('😂', custom), '😂')
  assert.equal(resolveEmoji('👍🏽', custom), '👍🏽')
  assert.equal(resolveEmoji('🇵🇪', custom), '🇵🇪')
  assert.equal(resolveEmoji('gnomo_inventado', custom), null)
  assert.equal(resolveEmoji('😂😂', custom), null)
  assert.equal(resolveEmoji('jaja', custom), null)
})

test('reacts only in whitelisted channels, only when the countdown hits, with the chosen emoji', async () => {
  const reacted: string[] = []
  const seen: { message: string; names: string[] }[] = []
  let hit = false
  const ambient = ambientReactions({
    channelIds: new Set(['10']),
    countdown: { tick: async () => hit },
    allowed: async () => true,
    listEmojis: async () => custom,
    choose: async (text, names) => {
      seen.push({ message: text, names })
      return 'gnomo_risa'
    },
    react: async (target, emoji) => {
      reacted.push(`${target.messageId}:${emoji}`)
    },
  })
  assert.deepEqual(await ambient.observe(message({ channelId: '99' })), {
    reacted: false,
    reason: 'channel',
  })
  assert.deepEqual(await ambient.observe(message()), { reacted: false, reason: 'countdown' })
  hit = true
  assert.deepEqual(await ambient.observe(message({ content: '   ' })), {
    reacted: false,
    reason: 'empty',
  })
  assert.deepEqual(await ambient.observe(message()), { reacted: true, emoji: 'gnomo_risa:123' })
  assert.deepEqual(reacted, ['900:gnomo_risa:123'])
  assert.deepEqual(seen, [
    { message: 'jajaja no puede ser', names: ['gnomo_risa', 'gnomo_triste'] },
  ])
})

test('no reaction when access is denied or nothing fits', async () => {
  const reacted: string[] = []
  let allowed = false
  let choice: string | null = 'gnomo_risa'
  const ambient = ambientReactions({
    channelIds: new Set(['10']),
    countdown: { tick: async () => true },
    allowed: async () => allowed,
    listEmojis: async () => custom,
    choose: async () => choice,
    react: async (_target, emoji) => {
      reacted.push(emoji)
    },
  })
  assert.deepEqual(await ambient.observe(message()), { reacted: false, reason: 'denied' })
  allowed = true
  choice = null
  assert.deepEqual(await ambient.observe(message()), { reacted: false, reason: 'no-fit' })
  choice = 'gnomo_que_no_existe'
  assert.deepEqual(await ambient.observe(message()), { reacted: false, reason: 'no-fit' })
  assert.deepEqual(reacted, [])
})

function discordClient() {
  return {
    token: 'test-only',
    user: { id: '99' },
    guilds: {
      fetch: async () => ({
        members: {
          fetch: async () => ({ id: '99', roles: { cache: new Map() } }),
        },
        channels: {
          fetch: async () => ({
            isTextBased: () => true,
            isThread: () => false,
            permissionsFor: () => ({ has: () => true }),
          }),
        },
      }),
    },
  } as unknown as Client
}

test('Discord composition is off without whitelisted channels or Redis', () => {
  const base = { GUILD_ID: 'g', RUNTIME_MODE: 'guild', OPENAI_API_KEY: 'test-only' }
  assert.equal(
    discordAmbientReactions({
      client: discordClient(),
      config: new ConfigService(base),
      redis: fakeRedis(),
    }),
    undefined,
  )
  assert.equal(
    discordAmbientReactions({
      client: discordClient(),
      config: new ConfigService({ ...base, AMBIENT_REACTION_CHANNEL_IDS: '10' }),
      redis: null,
    }),
    undefined,
  )
})

test('message handler counts untagged human messages and reacts through Discord on the hit', async () => {
  const config = new ConfigService({
    GUILD_ID: 'g',
    RUNTIME_MODE: 'guild',
    AMBIENT_REACTION_CHANNEL_IDS: '10, 11',
  })
  const puts: string[] = []
  const ticked: string[] = []
  const ambient = discordAmbientReactions({
    client: discordClient(),
    config,
    redis: fakeRedis(),
    // Hits on the third counted message.
    countdown: { tick: async (_guild, channel) => ticked.push(channel) === 3 },
    choose: async () => 'gnomo_risa',
    discordFetch: async (url, options) => {
      if (options?.method === 'PUT') {
        puts.push(String(url))
        return new Response(null, { status: 204 })
      }
      return new Response(
        JSON.stringify([{ id: '123', name: 'gnomo_risa', available: true, roles: [] }]),
      )
    },
  })
  assert.ok(ambient)
  const handled: string[] = []
  const handler = new MessageHandlerService(
    config,
    { getClient: () => ({ user: { id: '99' } }) } as DiscordService,
    new LoggerService(pino({ level: 'silent' })),
    {
      handle: async (invocation) => {
        handled.push(invocation.messageId)
      },
    },
    ambient,
  )
  let id = 0
  const send = async (content: string, { channelId = '10', bot = false } = {}) => {
    const message = {
      id: String(++id),
      guildId: 'g',
      channelId,
      content,
      createdTimestamp: 0,
      author: { id: bot ? '98' : 'u', username: 'Ana', bot },
      attachments: new Map(),
      channel: { type: 0 },
      reply: async () => {},
    } as unknown as Message
    await handler.handleMessage(message)
    // Ambient work is fire-and-forget; let it settle.
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await send('hola a todos')
  await send('<@99> cuéntame un chiste') // addressed to the bot: replied, never counted
  await send('soy otro bot', { bot: true })
  await send('mensaje en canal fuera de la lista', { channelId: '12' })
  await send('qué tal')
  assert.equal(puts.length, 0)
  await send('jajaja el gnomo') // third counted message
  assert.deepEqual(handled, ['2'])
  assert.deepEqual(ticked, ['10', '10', '10'])
  assert.deepEqual(puts, [
    `https://discord.com/api/v10/channels/10/messages/6/reactions/${encodeURIComponent('gnomo_risa:123')}/@me`,
  ])
})

test(
  'Redis script counts atomically across concurrent clients',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const url = process.env.T02_REDIS_URL!
    const namespace = `test:ambient:${randomUUID()}`
    const first = new Redis(url),
      second = new Redis(url)
    try {
      const a = redisReactionCountdown(first, Math.random, undefined, namespace)
      const b = redisReactionCountdown(second, Math.random, undefined, namespace)
      // 160 concurrent messages: gaps of 8-16 allow between 10 and 20 reactions.
      const results = await Promise.all(
        Array.from({ length: 160 }, (_, index) => (index % 2 ? a : b).tick('g', '10')),
      )
      const hits = results.filter(Boolean).length
      assert.ok(hits >= 10 && hits <= 20, `hits ${hits}`)
      const value = Number(await first.get(`${namespace}:g:10`))
      assert.ok(value >= 1 && value <= 16)
      // Deterministic sequence on a fresh channel: initial 8 means the 8th message reacts.
      const fixed = redisReactionCountdown(first, () => 0, undefined, namespace)
      const ticks: boolean[] = []
      for (let index = 0; index < 9; index++) ticks.push(await fixed.tick('g', 'fresh'))
      assert.deepEqual(ticks, [...Array(7).fill(false), true, false])
      assert.equal(await first.get(`${namespace}:g:fresh`), '7')
    } finally {
      const keys = await first.keys(`${namespace}:*`)
      if (keys.length) await first.del(...keys)
      first.disconnect()
      second.disconnect()
    }
  },
)
