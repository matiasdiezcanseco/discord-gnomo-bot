import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Client } from 'discord.js'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import type { ExecutionContext } from '../src/conversation/catalog'
import { discordReactions } from '../src/modules/discord/reactions'
import { composeConversation } from '../src/modules/discord/conversation-composition'
import { normalizeInvocation } from '../src/modules/discord/normalize-invocation'

const invocation = {
  messageId: '900',
  guildId: 'g',
  channelId: 'thread',
  referencedMessageId: '899',
  requester: { id: 'u', username: 'Ana' },
  content: 'reacciona al comentario con algo apropiado',
  createdAt: Date.now(),
  attachments: [],
}
function context(): ExecutionContext {
  return {
    invocation,
    signal: new AbortController().signal,
    idempotencyKey: 'test',
    external: (work) => work(),
  }
}
function client() {
  return {
    token: 'test-only',
    user: { id: 'bot' },
    guilds: {
      fetch: async () => ({
        members: {
          fetch: async () => ({ id: 'bot', roles: { cache: new Map([['allowed', {}]]) } }),
        },
        channels: {
          fetch: async () => ({
            isTextBased: () => true,
            isThread: () => true,
            archived: false,
            locked: false,
            permissionsFor: () => ({ has: () => true }),
          }),
        },
      }),
    },
  } as unknown as Client
}
const emojis = [
  { id: '123', name: 'gnomo_risa', animated: true, available: true, roles: [] },
  { id: '124', name: 'unavailable', available: false, roles: [] },
  { id: '125', name: 'restricted', available: true, roles: ['other'] },
  { id: '126', name: 'approved', available: true, roles: ['allowed'] },
]

test('composed conversation scans server emojis then reacts to the replied-to comment in its thread', async () => {
  const writes: string[] = []
  const reads: string[] = []
  let step = 0
  const conversation = composeConversation({
    client: client(),
    config: new ConfigService({
      GUILD_ID: 'g',
      RUNTIME_MODE: 'pilot',
      RUNTIME_CHANNEL_IDS: 'thread',
    }),
    redis: { set: async () => 'OK' } as unknown as Redis,
    discordFetch: async (url, options) => {
      if (options?.method === 'PUT') {
        writes.push(String(url))
        return new Response(null, { status: 204 })
      }
      reads.push(String(url))
      return new Response(JSON.stringify(String(url).endsWith('/emojis') ? emojis : []))
    },
    model: {
      generate: async ({ results, tools }) => {
        assert.ok(tools.some((tool) => tool.name === 'message_react'))
        if (step++ === 0)
          return { text: '', calls: [{ id: 'scan', name: 'server_emojis', input: {} }] }
        if (step === 2) {
          assert.equal(results[0].status, 'success')
          const value = results[0].value as { emojis: { emoji: string }[] }
          assert.deepEqual(
            value.emojis.map((item) => item.emoji),
            ['gnomo_risa:123', 'approved:126'],
          )
          return {
            text: '',
            calls: [
              { id: 'react', name: 'message_react', input: { emoji: value.emojis[0].emoji } },
            ],
          }
        }
        assert.equal(results[1].status, 'success')
        return { text: 'Listo, causa.', calls: [] }
      },
    },
  })
  await conversation.handle(invocation, async () => {})
  assert.ok(reads.includes('https://discord.com/api/v10/guilds/g/emojis'))
  assert.deepEqual(writes, [
    'https://discord.com/api/v10/channels/thread/messages/899/reactions/gnomo_risa%3A123/@me',
  ])
})

test('reaction requests encode Unicode/custom emoji and propagate HTTP failures without retrying', async () => {
  const requests: { url: string; options?: Parameters<typeof fetch>[1] }[] = []
  let status = 204
  const reactions = discordReactions(
    client(),
    async () => true,
    async (url, options) => {
      requests.push({ url: String(url), options })
      return new Response(null, { status })
    },
  )
  const ctx = context()
  await reactions.add(ctx, '899', '👍🏽')
  await reactions.add(ctx, '899', '<a:gnomo_risa:123>')
  assert.ok(requests[0].url.includes(encodeURIComponent('👍🏽')))
  assert.ok(requests[1].url.includes('gnomo_risa%3A123'))
  assert.equal(requests[0].options?.signal, ctx.signal)
  status = 403
  await assert.rejects(reactions.add(ctx, '899', '👍'), /HTTP 403/)
  assert.equal(requests.length, 3)
  status = 429
  await assert.rejects(reactions.add(ctx, '899', '👍'), /HTTP 429/)
  assert.equal(requests.length, 4)
})

test('revocation, cancellation and invalid target prevent reaction writes', async () => {
  let calls = 0
  const fetcher: typeof fetch = async () => {
    calls++
    return new Response(null, { status: 204 })
  }
  const denied = discordReactions(client(), async () => false, fetcher)
  await assert.rejects(denied.add(context(), '899', '👍'), /permission denied/)
  await assert.rejects(denied.list(context()), /permission denied/)
  const allowed = discordReactions(client(), async () => true, fetcher)
  await assert.rejects(allowed.add(context(), '../other', '👍'), /Invalid message/)
  await assert.rejects(allowed.add({ ...context(), signal: AbortSignal.abort() }, '899', '👍'))
  assert.equal(calls, 0)
})

test('emoji scan filters by name and reports bounded results as partial', async () => {
  const many = Array.from({ length: 500 }, (_, i) => ({
    id: String(i),
    name: `gnomo_${'x'.repeat(25)}${i}`,
    available: true,
  }))
  const reactions = discordReactions(
    client(),
    async () => true,
    async () => new Response(JSON.stringify(many)),
  )
  const result = await reactions.list(context())
  assert.equal(result.partial, true)
  assert.ok(JSON.stringify(result).length <= 14000)
  const filtered = await reactions.list(context(), '499')
  assert.equal(filtered.partial, false)
  assert.equal(filtered.emojis.length, 1)
})

test('normalization retains only same-channel reply targets', () => {
  const event = {
    id: '900',
    guildId: 'g',
    channelId: 'thread',
    createdTimestamp: 1,
    content: '<@99> reacciona',
    author: { id: 'u', username: 'Ana', bot: false },
    attachments: new Map(),
    reference: { channelId: 'thread', messageId: '899' },
  }
  assert.equal(normalizeInvocation(event, 'g', '99')?.referencedMessageId, '899')
  assert.equal(
    normalizeInvocation(
      { ...event, reference: { channelId: 'other', messageId: '899' } },
      'g',
      '99',
    )?.referencedMessageId,
    undefined,
  )
})
