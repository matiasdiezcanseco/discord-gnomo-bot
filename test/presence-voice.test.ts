import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { Collection, GatewayIntentBits, type Client } from 'discord.js'
import type Redis from 'ioredis'
import { composeConversation } from '../src/modules/discord/conversation-composition'
import type { Reply } from '../src/conversation/harness'

function fixture() {
  const intents = new Set<number>([
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
  ])
  const presences = new Collection<string, { status: string }>([
    ['111', { status: 'online' }],
    ['222', { status: 'idle' }],
    ['333', { status: 'dnd' }],
    ['444', { status: 'offline' }],
  ])
  const people = ['111', '222', '333', '444', '555', '666'].map((id) => ({
    user: { id, username: `person${id}` },
  }))
  const denied = new Set<string>(['hidden:u'])
  let ready = true
  let available = true
  let fail = false
  let memberFail = false
  const voice = new Collection([
    ['111', { id: '111', channelId: 'visible' }],
    ['222', { id: '222', channelId: 'hidden' }],
    ['555', { id: '555', channelId: 'visible' }],
  ])
  const channel = (id: string) => ({
    id,
    name: id === 'hidden' ? 'SECRET ROOM' : 'Sala',
    isTextBased: () => id === 'c',
    isVoiceBased: () => id !== 'c',
    isThread: () => false,
    permissionsFor: (member: { id: string }) => ({ has: () => !denied.has(`${id}:${member.id}`) }),
  })
  const guild = {
    get available() {
      return available
    },
    presences: { cache: presences },
    voiceStates: { cache: voice },
    members: { fetch: async ({ user }: { user: string }) => ({ id: user }) },
    channels: {
      fetch: async (id?: string) => {
        if (fail && !id) throw new Error('unavailable')
        return id
          ? channel(id)
          : new Collection(['visible', 'hidden'].map((id) => [id, channel(id)]))
      },
    },
  }
  const client = {
    token: 'fake',
    user: { id: 'bot' },
    options: { intents: { has: (id: number) => intents.has(id) } },
    isReady: () => ready,
    guilds: { fetch: async () => guild, cache: new Collection([['g', guild]]) },
  } as unknown as Client
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/messages')) return new Response('[]')
    if (memberFail) return new Response('', { status: 403 })
    const after = url.searchParams.get('after')
    return new Response(
      JSON.stringify(
        people
          .filter((p) => !after || p.user.id > after)
          .slice(0, Number(url.searchParams.get('limit') ?? 25)),
      ),
    )
  }
  const replies: Reply[] = []
  async function run(name = 'presence_list', input: unknown = {}) {
    const app = composeConversation({
      client: client,
      config: new ConfigService({ GUILD_ID: 'g', RUNTIME_MODE: 'pilot', RUNTIME_CHANNEL_IDS: 'c' }),
      redis: { set: async () => 'OK' } as unknown as Redis,
      model: {
        generate: async ({ results }) =>
          results.length
            ? { text: JSON.stringify(results), calls: [] }
            : { text: '', calls: [{ id: 'query', name, input }] },
      },
      discordFetch: fetcher,
    })
    await app.handle(
      {
        messageId: randomUUID(),
        guildId: 'g',
        channelId: 'c',
        requester: { id: 'u', username: 'Luis' },
        content: 'quién está conectado o en llamada',
        createdAt: 0,
        attachments: [],
      },
      async (_, reply) => {
        replies.push(reply)
      },
    )
    assert.deepEqual(replies.at(-1)!.allowedMentions.users, [])
    return JSON.parse(replies.at(-1)!.content)[0]
  }
  return {
    run,
    intents,
    presences,
    denied,
    voice,
    setReady: (v: boolean) => {
      ready = v
    },
    setAvailable: (v: boolean) => {
      available = v
    },
    setFail: () => {
      fail = true
    },
    failMembers: () => {
      memberFail = true
    },
  }
}

test('presence preserves visible states and distinguishes apparent disconnection from missing data', async () => {
  const result = await fixture().run()
  assert.equal(result.status, 'partial')
  assert.equal(result.value.coverage, 'partial')
  assert.deepEqual(
    result.value.members.map((m: { status: string; connected: boolean | null }) => [
      m.status,
      m.connected,
    ]),
    [
      ['online', true],
      ['idle', true],
      ['dnd', true],
      ['offline', false],
      ['unknown', null],
      ['unknown', null],
    ],
  )
  assert.equal(result.value.members[3].label, 'aparece desconectado')
  assert.equal(result.value.members[4].id, '555')
  assert.ok(Number.isFinite(Date.parse(result.value.queriedAt)))
  assert.match(result.value.note, /invisible/i)
})

test('voice is separate and omits hidden channels and their participants', async () => {
  const f = fixture()
  const result = await f.run('voice_list')
  assert.equal(result.status, 'partial')
  assert.equal(result.value.coverage, 'partial')
  assert.deepEqual(
    result.value.participants.map((m: { id: string }) => m.id),
    ['111', '555'],
  )
  assert.deepEqual(result.value.participants[0].channel, { id: 'visible', name: 'Sala' })
  assert.equal(result.value.participants[0].status, undefined)
  assert.ok(Number.isFinite(Date.parse(result.value.queriedAt)))
  assert.doesNotMatch(JSON.stringify(result), /hidden|SECRET|222/)
  f.denied.add('visible:u')
  const revoked = await f.run('voice_list')
  assert.deepEqual(revoked.value.participants, [])
})

test('missing intents, initialization and unavailable guilds never imply disconnection', async () => {
  for (const setup of [
    (f: ReturnType<typeof fixture>) => f.intents.delete(GatewayIntentBits.GuildPresences),
    (f: ReturnType<typeof fixture>) => f.setReady(false),
    (f: ReturnType<typeof fixture>) => f.setAvailable(false),
    (f: ReturnType<typeof fixture>) => f.presences.clear(),
  ]) {
    const f = fixture()
    setup(f)
    const result = await f.run()
    assert.equal(result.value.coverage, 'unknown')
    assert.ok(
      result.value.members.every(
        (m: { status: string; connected: unknown }) =>
          m.status === 'unknown' && m.connected === null,
      ),
    )
  }
  const f = fixture()
  f.presences.set('555', { status: 'invisible' })
  assert.equal((await f.run()).value.members[4].status, 'unknown')
})

test('member pagination preserves cursors without claiming complete presence or voice', async () => {
  for (const name of ['presence_list', 'voice_list']) {
    const f = fixture()
    const first = await f.run(name, { limit: 2 })
    assert.equal(first.value.memberCoverage, 'partial')
    assert.equal(first.value.nextAfter, '222')
    assert.equal(first.value.fromAfter, null)
    const next = await f.run(name, { after: '444' })
    assert.equal(next.value.memberCoverage, 'complete')
    assert.equal(next.value.fromAfter, '444')
    assert.notEqual(next.value.coverage, 'complete')
  }
})

test('voice fails closed for bot visibility, missing intent, uninitialized state and failed reads', async () => {
  const f = fixture()
  f.denied.add('visible:bot')
  assert.deepEqual((await f.run('voice_list')).value.participants, [])
  for (const setup of [
    (f: ReturnType<typeof fixture>) => f.intents.delete(GatewayIntentBits.GuildVoiceStates),
    (f: ReturnType<typeof fixture>) => f.setReady(false),
    (f: ReturnType<typeof fixture>) => f.setAvailable(false),
    (f: ReturnType<typeof fixture>) => f.failMembers(),
    (f: ReturnType<typeof fixture>) => f.setFail(),
    (f: ReturnType<typeof fixture>) => f.intents.delete(GatewayIntentBits.GuildMembers),
  ]) {
    const f = fixture()
    setup(f)
    const result = await f.run('voice_list')
    assert.equal(result.value.coverage, 'unknown')
    assert.deepEqual(result.value.participants, [])
  }
})

test('model arguments cannot replace the authenticated scope or request unbounded data', async () => {
  for (const name of ['presence_list', 'voice_list']) {
    for (const input of [
      { guildId: 'other' },
      { channelId: 'hidden' },
      { requester: 'admin' },
      { limit: 51 },
    ]) {
      assert.equal((await fixture().run(name, input)).status, 'invalid')
    }
  }
})
