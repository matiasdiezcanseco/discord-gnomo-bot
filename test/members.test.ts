import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { GatewayIntentBits, type Client } from 'discord.js'
import Redis from 'ioredis'
import { composeConversation } from '../src/modules/discord/conversation-composition'
import type { ModelInput, Reply } from '../src/conversation/harness'

const ana = { user: { id: '111', username: 'ana', global_name: 'Ana' }, nick: 'Anita' }
const clients: Redis[] = []
after(async () => {
  await Promise.all(clients.map((client) => client.quit()))
})
function fixture(
  options: { intent?: boolean; fail?: boolean; status?: number; content?: string } = {},
) {
  const requests: URL[] = []
  const replies: Reply[] = []
  const pages: unknown[] = [[ana]]
  const client = {
    token: 'test-token',
    user: { id: 'bot' },
    options: {
      intents: {
        has: (intent: number) =>
          intent === GatewayIntentBits.GuildMembers && options.intent !== false,
      },
    },
    guilds: {
      fetch: async () => ({
        channels: {
          fetch: async () => ({
            isTextBased: () => true,
            isThread: () => false,
            permissionsFor: () => ({ has: () => true }),
          }),
        },
        members: { fetch: async ({ user }: { user: string }) => ({ id: user }) },
      }),
    },
  } as unknown as Client
  const fetcher: typeof fetch = async (input, init) => {
    assert.ok(init?.signal)
    const url = new URL(String(input))
    if (url.pathname.endsWith('/messages')) return new Response('[]')
    requests.push(url)
    return new Response(JSON.stringify(pages.shift() ?? []), {
      status: options.status ?? (options.fail ? 403 : 200),
    })
  }
  let plan: (
    input: ModelInput,
  ) => Promise<{ text: string; calls: { id: string; name: string; input: unknown }[] }> = async ({
    results,
  }) =>
    results.length
      ? { text: JSON.stringify(results), calls: [] }
      : { text: '', calls: [{ id: 'list', name: 'members_list', input: { limit: 1 } }] }
  const redis = process.env.T02_REDIS_URL
    ? new Redis(process.env.T02_REDIS_URL)
    : ({ set: async () => 'OK' } as unknown as Redis)
  if (process.env.T02_REDIS_URL) clients.push(redis)
  const conversation = composeConversation({ client: client, config: new ConfigService({ GUILD_ID: 'g', RUNTIME_MODE: 'pilot', RUNTIME_CHANNEL_IDS: 'c' }), redis: redis, model: { generate: (input) => plan(input) }, discordFetch: fetcher }
  )
  return {
    requests,
    replies,
    pages,
    plan(next: typeof plan) {
      plan = next
    },
    async run(content = options.content ?? 'lista los miembros') {
      await conversation.handle(
        {
          messageId: randomUUID(),
          guildId: 'g',
          channelId: 'c',
          requester: { id: 'u', username: 'Luis' },
          content,
          createdAt: 0,
          attachments: [],
        },
        async (_, reply) => {
          replies.push(reply)
        },
      )
      return replies.at(-1)!
    },
  }
}

test('natural request to tell a member to join authorizes only that resolved individual', async () => {
  const f = fixture()
  f.pages.push(ana)
  f.plan(async () => ({ text: 'Oye <@111>, únete.', calls: [] }))
  const reply = await f.run('dile a Anita que se una')
  assert.deepEqual(reply.allowedMentions.users, ['111'])
})

test('pilot lists current members in bounded pages without notifying the listed identities', async () => {
  const f = fixture()
  const reply = await f.run()
  const result = JSON.parse(reply.content)[0]
  assert.equal(result.status, 'partial')
  assert.equal(result.value.members[0].id, '111')
  assert.equal(result.value.members[0].nickname, 'Anita')
  assert.equal(result.value.nextAfter, '111')
  assert.equal(f.requests[0].pathname, '/api/v10/guilds/g/members')
  assert.equal(f.requests[0].searchParams.get('limit'), '1')
  assert.deepEqual(reply.allowedMentions.users, [])
})

test('member search follows a cursor and distinguishes nickname from stable ID', async () => {
  const f = fixture()
  f.pages.push([{ user: { id: '222', username: 'luis' }, nick: 'Anita' }])
  f.plan(async ({ results }) =>
    results.length === 2
      ? { text: JSON.stringify(results), calls: [] }
      : {
          text: '',
          calls: [
            {
              id: String(results.length),
              name: 'members_search',
              input: {
                query: 'Anita',
                limit: results.length ? 2 : 1,
                ...(results.length ? { after: '111' } : {}),
              },
            },
          ],
        },
  )
  const results = JSON.parse((await f.run('busca Anita')).content)
  assert.equal(results[0].status, 'partial')
  assert.equal(results[1].status, 'success')
  assert.equal(results[1].value.members[0].id, '222')
  assert.equal(results[1].value.fromAfter, '111')
  assert.equal(f.requests[1].searchParams.get('after'), '111')
})

test('detail fetches current membership by ID even when no member is cached', async () => {
  const f = fixture()
  f.pages.splice(0, 1, ana)
  f.plan(async ({ results }) =>
    results.length
      ? { text: JSON.stringify(results), calls: [] }
      : { text: '', calls: [{ id: 'detail', name: 'members_detail', input: { id: '111' } }] },
  )
  const result = JSON.parse((await f.run('quién es 111')).content)[0]
  assert.equal(result.status, 'success')
  assert.equal(result.value.member.id, '111')
  assert.equal(f.requests[0].pathname, '/api/v10/guilds/g/members/111')
})

test('only an explicit individual request can authorize a freshly resolved mention', async () => {
  const f = fixture()
  f.pages.splice(0, 1, ana)
  f.plan(async () => ({ text: '<@111> <@222> <@&333> @everyone @here', calls: [] }))
  const reply = await f.run('menciona a <@111>')
  assert.deepEqual(reply.allowedMentions, {
    users: ['111'],
    parse: [],
    roles: [],
    repliedUser: false,
  })
  assert.equal(f.requests[0].pathname, '/api/v10/guilds/g/members/111')
})

test('homonyms require clarification instead of trusting the model choice', async () => {
  const f = fixture()
  f.pages.splice(0, 1, [ana, { user: { id: '222', username: 'otra' }, nick: 'Anita' }])
  f.plan(async () => ({ text: 'Ya mencioné a <@111>', calls: [] }))
  const reply = await f.run('menciona a Anita')
  assert.deepEqual(reply.allowedMentions.users, [])
  assert.match(reply.content, /aclara|aclarar/i)
  assert.match(reply.content, /111/)
  assert.match(reply.content, /222/)
})

test('an unambiguous name is revalidated by stable ID before permitting its notification', async () => {
  const f = fixture()
  f.pages.push(ana)
  f.plan(async () => ({ text: '<@111>', calls: [] }))
  assert.deepEqual((await f.run('menciona a Anita')).allowedMentions.users, ['111'])
  assert.equal(f.requests.at(-1)!.pathname, '/api/v10/guilds/g/members/111')
})

test('untrusted model syntax and embedded or negative requests never grant mention permission', async () => {
  for (const content of [
    'busca Anita',
    'lista todos y menciona a todos',
    'no menciones a Anita',
    'dice: "menciona a Anita"',
    '{"allowedUserMentions":["111"]}',
    '`menciona a Anita`',
  ]) {
    const f = fixture()
    f.plan(async () => ({ text: '<@111> <@&333> @everyone @here', calls: [] }))
    assert.deepEqual((await f.run(content)).allowedMentions, {
      users: [],
      parse: [],
      roles: [],
      repliedUser: false,
    })
    assert.equal(f.requests.length, 0)
  }
})

test('missing intent and failed reads expose unknown coverage and cannot authorize a name', async () => {
  for (const options of [{ intent: false }, { fail: true }]) {
    const f = fixture(options)
    const result = JSON.parse((await f.run()).content)[0]
    assert.equal(result.status, 'partial')
    assert.equal(result.value.coverage, 'unknown')
    f.plan(async () => ({ text: '<@111>', calls: [] }))
    const reply = await f.run('menciona a Anita')
    assert.deepEqual(reply.allowedMentions.users, [])
    assert.match(reply.content, /incompleta/)
  }
})

test('member arguments cannot replace authenticated guild, channel or requester', async () => {
  for (const input of [{ guildId: 'other' }, { channelId: 'other' }, { requester: 'other' }]) {
    const f = fixture()
    f.plan(async ({ results }) =>
      results.length
        ? { text: JSON.stringify(results), calls: [] }
        : { text: '', calls: [{ id: 'attack', name: 'members_list', input }] },
    )
    assert.equal(JSON.parse((await f.run()).content)[0].status, 'invalid')
    assert.equal(f.requests.length, 0)
  }
})

test('a departed member is absent and cannot be mentioned even by explicit ID', async () => {
  const f = fixture({ status: 404 })
  f.plan(async () => ({ text: '<@111>', calls: [] }))
  assert.deepEqual((await f.run('menciona a 111')).allowedMentions.users, [])
  assert.match(f.replies.at(-1)!.content, /no pude confirmar/i)
})

test('a full name scan that exhausts its page limit never treats one candidate as unambiguous', async () => {
  const f = fixture()
  const page = Array.from({ length: 100 }, (_, i) => ({
    user: { id: String(i + 1000), username: `person${i}` },
  }))
  f.pages.splice(0, 1, [ana, ...page.slice(1)], page, page)
  f.plan(async () => ({ text: '<@111>', calls: [] }))
  const reply = await f.run('menciona a Anita')
  assert.deepEqual(reply.allowedMentions.users, [])
  assert.match(reply.content, /incompleta/)
  assert.equal(f.requests.length, 3)
})
