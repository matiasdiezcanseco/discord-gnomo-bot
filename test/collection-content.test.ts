import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createConversation, type Reply, type Trace } from '../src/conversation/harness'
import { composeCapabilities } from '../src/conversation/capabilities'
import { bucketCollection } from '../src/conversation/collection-content'
import type { Invocation } from '../src/core/conversation/invocation'

const invocation: Invocation = {
  messageId: 'm1',
  guildId: 'g1',
  channelId: 'c1',
  requester: { id: 'u1', username: 'Ana' },
  content: 'dame una frase',
  createdAt: 0,
  attachments: [],
}

function setup(data: unknown = ['Soy pequeño pero peligroso.']) {
  const replies: Reply[] = []
  const traces: Trace[] = []
  const requests: { url: string; signal: AbortSignal | null | undefined }[] = []
  let modelCalls = 0
  const collection = bucketCollection('https://collection.example/', async (url, init) => {
    requests.push({ url: String(url), signal: init?.signal })
    return Response.json(data)
  })
  const ports = {
    catalog: composeCapabilities({ collection: collection }),
    model: {
      generate: async () => {
        modelCalls++
        return { text: 'Conversación normal.', calls: [] }
      },
    },
    claim: async () => true,
    authorize: async () => true,
    reply: async (_: Invocation, reply: Reply) => {
      replies.push(reply)
    },
    trace: (trace: Trace) => traces.push(trace),
  }
  return { ports, replies, traces, requests, modelCalls: () => modelCalls }
}

test('a direct phrase invocation delivers unchanged collection content without a model', async () => {
  const app = setup(['Soy pequeño pero peligroso. @everyone <@&123>'])
  await createConversation(app.ports).handle(invocation)
  assert.equal(app.replies[0].content, 'Soy pequeño pero peligroso. @everyone <@&123>')
  assert.deepEqual(app.replies[0].allowedMentions, {
    parse: [],
    users: [],
    roles: [],
    repliedUser: false,
  })
  assert.equal(app.modelCalls(), 0)
  assert.equal(app.requests.length, 1)
  assert.equal(app.requests[0].url, 'https://collection.example/phrases.json')
  assert.ok(app.requests[0].signal instanceof AbortSignal)
  assert.equal(app.traces.at(-1)?.calls, 2)
})

test('a direct photo invocation delivers an existing bucket URL without calling it generated', async () => {
  const app = setup(['photos/gnomo%20uno.jpg'])
  await createConversation(app.ports).handle({
    ...invocation,
    content: 'Mándame una foto aleatoria!',
  })
  assert.equal(app.replies[0].content, 'https://collection.example/photos/gnomo%20uno.jpg')
  assert.equal(app.modelCalls(), 0)
  assert.equal(app.requests[0].url, 'https://collection.example/images.json')
})

import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import type { Client } from 'discord.js'
import Redis from 'ioredis'
import { composeConversation } from '../src/modules/discord/conversation-composition'

test(
  'the real pilot composition delivers collection resources and claims a concurrent event once',
  { skip: !process.env.T02_REDIS_URL },
  async (t) => {
    const requests: string[] = []
    const server = createServer((request, response) => {
      requests.push(request.url!)
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify(request.url === '/phrases.json' ? ['Frase del piloto.'] : ['gnomo.jpg']),
      )
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}/`
    let allowed = true
    const client = {
      user: { id: 'bot' },
      guilds: {
        fetch: async () => ({
          channels: {
            fetch: async () => ({
              isTextBased: () => true,
              isThread: () => false,
              permissionsFor: () => ({ has: () => allowed }),
            }),
          },
          members: { fetch: async ({ user }: { user: string }) => ({ id: user }) },
        }),
      },
    } as unknown as Client
    const first = new Redis(process.env.T02_REDIS_URL!)
    const second = new Redis(process.env.T02_REDIS_URL!)
    const replies: Reply[] = []
    const config = new ConfigService({
      GUILD_ID: 'g1',
      RUNTIME_MODE: 'pilot', RUNTIME_CHANNEL_IDS: 'c1',
      BUCKET_URL: base,
    })
    const model = {
      generate: async () => {
        throw new Error('Direct path must not use model')
      },
    }
    const build = (redis: Redis) => composeConversation({ client: client, config: config, redis: redis, model: model })
    const reply = async (_: Invocation, value: Reply) => {
      replies.push(value)
    }
    const input = { ...invocation, messageId: randomUUID() }
    try {
      const start = performance.now()
      await Promise.all([build(first).handle(input, reply), build(second).handle(input, reply)])
      t.diagnostic(
        `Local HTTP + isolated Redis + simulated Discord completion: ${(performance.now() - start).toFixed(1)}ms; not production latency`,
      )
      assert.deepEqual(
        replies.map((r) => r.content),
        ['Frase del piloto.'],
      )
      await build(first).handle(
        { ...input, messageId: randomUUID(), content: 'dame una foto' },
        reply,
      )
      assert.equal(replies[1].content, `${base}gnomo.jpg`)
      assert.deepEqual(requests, ['/phrases.json', '/images.json'])
      allowed = false
      await build(first).handle({ ...input, messageId: randomUUID() }, reply)
      assert.equal(replies.length, 2)
      assert.equal(requests.length, 2)
      allowed = true
      const samples: number[] = []
      for (let index = 0; index < 20; index++) {
        const start = performance.now()
        await build(first).handle({ ...input, messageId: randomUUID() }, reply)
        samples.push(performance.now() - start)
      }
      samples.sort((a, b) => a - b)
      assert.equal(replies.length, 22)
      t.diagnostic(
        `20 local completions: p50=${samples[9].toFixed(1)}ms p95=${samples[18].toFixed(1)}ms outside 3000ms=${samples.filter((ms) => ms >= 3000).length}/20; production target remains unmeasured`,
      )
    } finally {
      await Promise.all([first.quit(), second.quit()])
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)

test('a natural variant uses the registered collection tool and keeps the resource intact', async () => {
  const app = setup(['Así habla Gnomo.'])
  let turns = 0
  const conversation = createConversation({
    ...app.ports,
    model: {
      generate: async ({ tools, results }) => {
        turns++
        assert.ok(tools.some((tool) => tool.name === 'collection_phrase'))
        return results.length
          ? { text: (results[0].value as { text: string }).text, calls: [] }
          : { text: '', calls: [{ id: 'natural', name: 'collection_phrase', input: {} }] }
      },
    },
  })
  await conversation.handle({
    ...invocation,
    content: '¿Con qué dicho de los nuestros me sorprenderías hoy?',
  })
  assert.equal(app.replies[0].content, 'Así habla Gnomo.')
  assert.equal(turns, 2)
  assert.equal(app.requests.length, 1)
  assert.equal(app.traces.at(-1)?.calls, 2)
})

test('empty collections and failed dependencies give useful notices without invented links or model calls', async () => {
  for (const data of [[], { invalid: 'not an array' }, ['https://elsewhere.example/fake.jpg']]) {
    const app = setup(data)
    await createConversation(app.ports).handle({ ...invocation, content: 'dame una foto' })
    assert.match(app.replies[0].content, /(?:No hay fotos|No pude consultar)/)
    assert.doesNotMatch(app.replies[0].content, /https?:/)
    assert.equal(app.requests.length, 1)
    assert.equal(app.modelCalls(), 0)
  }
  const app = setup()
  await createConversation({
    ...app.ports,
    catalog: composeCapabilities({ collection: bucketCollection(undefined) }),
  }).handle(invocation)
  assert.match(app.replies[0].content, /No pude consultar/)
  assert.equal(app.requests.length, 0)
  assert.equal(app.modelCalls(), 0)
  for (const response of [
    () => Promise.resolve(new Response(null, { status: 503 })),
    async () => {
      throw new Error('offline')
    },
  ]) {
    const app = setup()
    let requests = 0
    const source = bucketCollection('https://collection.example/', async () => {
      requests++
      return response()
    })
    await createConversation({ ...app.ports, catalog: composeCapabilities({ collection: source }) }).handle(invocation)
    assert.match(app.replies[0].content, /No pude consultar/)
    assert.equal(requests, 1)
    assert.equal(app.modelCalls(), 0)
  }
})

test('a hung collection read is cancelled at twelve seconds without a model or retry', async () => {
  const app = setup()
  let time = 0
  const timers = new Map<() => void, number>()
  const clock = {
    now: () => time,
    schedule: (callback: () => void, delay: number) => {
      timers.set(callback, time + delay)
      return () => {
        timers.delete(callback)
      }
    },
  }
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let signal: AbortSignal | null | undefined
  let requests = 0
  const source = bucketCollection('https://collection.example/', async (_, init) => {
    signal = init?.signal
    requests++
    started()
    return new Promise<Response>(() => {})
  })
  const running = createConversation({ ...app.ports, clock, catalog: composeCapabilities({ collection: source }) }).handle(
    invocation,
  )
  await ready
  time = 12000
  for (const [callback, at] of timers) if (at <= time) callback()
  await running
  assert.equal(signal?.aborted, true)
  assert.match(app.replies[0].content, /tiempo/)
  assert.equal(app.modelCalls(), 0)
  assert.equal(requests, 1)
  assert.equal(app.traces.at(-1)?.elapsedMs, 12000)
})

test('direct requests revalidate tool access and delivery access before exposing collection data', async () => {
  const denied = setup()
  await createConversation({ ...denied.ports, authorize: async (_, tool) => !tool }).handle(
    invocation,
  )
  assert.equal(denied.requests.length, 0)
  assert.match(denied.replies[0].content, /permiso/)
  assert.equal(denied.modelCalls(), 0)

  const revoked = setup()
  let checks = 0
  await createConversation({ ...revoked.ports, authorize: async () => ++checks < 3 }).handle(
    invocation,
  )
  assert.equal(revoked.requests.length, 1)
  assert.equal(revoked.replies.length, 0)
  assert.equal(revoked.modelCalls(), 0)
})

test('ambiguous, quoted, negated, combined, and attachment requests stay on the normal conversation path', async () => {
  for (const content of [
    'hola',
    'no me des una frase',
    '"dame una foto"',
    'dame una frase y una foto',
    'dame una frase sobre mi futuro',
    '¿qué significa foto?',
  ]) {
    const app = setup()
    await createConversation(app.ports).handle({ ...invocation, content })
    assert.equal(app.modelCalls(), 1, content)
    assert.equal(app.requests.length, 0, content)
  }
  const app = setup()
  await createConversation(app.ports).handle({
    ...invocation,
    attachments: [
      {
        id: 'a',
        url: 'https://example.test/a.jpg',
        name: 'a.jpg',
        contentType: 'image/jpeg',
        size: 1,
      },
    ],
  })
  assert.equal(app.modelCalls(), 0)
  assert.match(app.replies[0].content, /adjuntos/)
  assert.equal(app.requests.length, 0)
})

test('model arguments cannot redirect collection reads or grant requester identity', async () => {
  const app = setup()
  await createConversation({
    ...app.ports,
    model: {
      generate: async ({ results }) =>
        results.length
          ? { text: `Resultado: ${results[0].status}`, calls: [] }
          : {
              text: '',
              calls: [
                {
                  id: 'bad',
                  name: 'collection_photo',
                  input: { guildId: 'other', requester: 'owner', url: 'https://evil.example/' },
                },
              ],
            },
    },
  }).handle({ ...invocation, content: 'Muéstrame uno de nuestros recuerdos en foto.' })
  assert.equal(app.replies[0].content, 'Resultado: invalid')
  assert.equal(app.requests.length, 0)
})
