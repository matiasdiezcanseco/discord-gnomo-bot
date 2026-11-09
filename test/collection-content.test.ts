import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createConversation,
  type ConversationPorts,
  type ModelTurn,
  type Reply,
  type Trace,
} from '../src/conversation/harness'
import { composeCapabilities } from '../src/conversation/capabilities'
import { bucketCollection } from '../src/conversation/collection-content'
import type { Invocation } from '../src/core/conversation/invocation'

const invocation: Invocation = {
  messageId: 'm1',
  guildId: 'g1',
  channelId: 'c1',
  requester: { id: 'u1', username: 'Ana' },
  content: 'tírate una del gnomo pues',
  createdAt: 0,
  attachments: [],
}

/** Stand-in for the model's intent judgement: it simply picks the tool the test names. */
const chooses =
  (name?: string, input: unknown = {}): ConversationPorts['model']['generate'] =>
  async ({ results }) =>
    name && !results.length
      ? { text: '', calls: [{ id: 'intent', name, input }] }
      : { text: 'Conversación normal.', calls: [] }

function setup(data: unknown = ['Soy pequeño pero peligroso.'], tool = 'collection_phrase') {
  const replies: Reply[] = []
  const traces: Trace[] = []
  const requests: { url: string; signal: AbortSignal | null | undefined }[] = []
  let modelCalls = 0
  const collection = bucketCollection('https://collection.example/', async (url, init) => {
    requests.push({ url: String(url), signal: init?.signal })
    return Response.json(data)
  })
  const choose = chooses(tool)
  const ports = {
    catalog: composeCapabilities({ collection: collection }),
    model: {
      generate: async (input: Parameters<ConversationPorts['model']['generate']>[0]) => {
        modelCalls++
        return choose(input)
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

test('a phrase chosen by the model from intent is delivered verbatim in one model step', async () => {
  const app = setup(['Soy pequeño pero peligroso. @everyone <@&123>'])
  await createConversation(app.ports).handle(invocation)
  assert.equal(app.replies[0].content, 'Soy pequeño pero peligroso. @everyone <@&123>')
  assert.deepEqual(app.replies[0].allowedMentions, {
    parse: [],
    users: [],
    roles: [],
    repliedUser: false,
  })
  assert.equal(app.modelCalls(), 1)
  assert.equal(app.requests.length, 1)
  assert.equal(app.requests[0].url, 'https://collection.example/phrases.json')
  assert.ok(app.requests[0].signal instanceof AbortSignal)
})

test('a photo chosen by the model is delivered as the existing bucket URL', async () => {
  const app = setup(['photos/gnomo%20uno.jpg'], 'collection_photo')
  await createConversation(app.ports).handle({
    ...invocation,
    content: 'pásame algo para ver del gnomo',
  })
  assert.equal(app.replies[0].content, 'https://collection.example/photos/gnomo%20uno.jpg')
  assert.equal(app.modelCalls(), 1)
  assert.equal(app.requests[0].url, 'https://collection.example/images.json')
})

test('wording alone never triggers the collection: without the model choosing it, nothing is read', async () => {
  for (const content of ['dame una frase', 'dame una foto', 'Mándame una foto aleatoria!']) {
    const app = setup(undefined, '')
    await createConversation(app.ports).handle({ ...invocation, content })
    assert.equal(app.modelCalls(), 1, content)
    assert.equal(app.requests.length, 0, content)
    assert.equal(app.replies[0].content, 'Conversación normal.', content)
  }
})

test('the collection tools are always offered to the model, with no keyword matcher', () => {
  const tools = composeCapabilities({
    collection: bucketCollection('https://collection.example/'),
  }).tools.filter((tool) => tool.name.startsWith('collection_'))
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['collection_phrase', 'collection_photo'],
  )
  for (const tool of tools) {
    assert.equal('direct' in tool, false)
    assert.equal(typeof tool.verbatim, 'function')
  }
})

test('a verbatim result the model omitted from a combined answer is appended unchanged', async () => {
  const app = setup(['Así habla Gnomo.'])
  let turns = 0
  await createConversation({
    ...app.ports,
    model: {
      generate: async ({ results }): Promise<ModelTurn> => {
        turns++
        return results.length
          ? { text: 'Aquí tienes una frase y el estado del bot.', calls: [] }
          : {
              text: '',
              calls: [
                { id: 'p', name: 'collection_phrase', input: {} },
                { id: 's', name: 'runtime_status', input: {} },
              ],
            }
      },
    },
  }).handle({ ...invocation, content: 'una frase del gnomo y dime cómo estás' })
  assert.equal(turns, 2)
  assert.equal(
    app.replies.map((r) => r.content).join('\n'),
    'Aquí tienes una frase y el estado del bot.\nAsí habla Gnomo.',
  )
})

test('empty collections and failed dependencies give useful notices without invented links', async () => {
  for (const data of [[], { invalid: 'not an array' }, ['https://elsewhere.example/fake.jpg']]) {
    const app = setup(data, 'collection_photo')
    await createConversation(app.ports).handle(invocation)
    assert.match(app.replies[0].content, /(?:No hay fotos|No pude consultar)/)
    assert.doesNotMatch(app.replies[0].content, /https?:/)
    assert.equal(app.requests.length, 1)
    assert.equal(app.modelCalls(), 1)
  }
  const app = setup()
  await createConversation({
    ...app.ports,
    catalog: composeCapabilities({ collection: bucketCollection(undefined) }),
  }).handle(invocation)
  assert.match(app.replies[0].content, /No pude consultar/)
  assert.equal(app.requests.length, 0)
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
    await createConversation({
      ...app.ports,
      catalog: composeCapabilities({ collection: source }),
    }).handle(invocation)
    assert.match(app.replies[0].content, /No pude consultar/)
    assert.equal(requests, 1)
    assert.equal(app.modelCalls(), 1)
  }
})

test('a hung collection read is cancelled at twelve seconds without a retry', async () => {
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
  const running = createConversation({
    ...app.ports,
    clock,
    catalog: composeCapabilities({ collection: source }),
  }).handle(invocation)
  await ready
  time = 12000
  for (const [callback, at] of timers) if (at <= time) callback()
  await running
  assert.equal(signal?.aborted, true)
  assert.match(app.replies[0].content, /tiempo/)
  assert.equal(app.modelCalls(), 1)
  assert.equal(requests, 1)
})

test('collection reads revalidate tool access and delivery access before exposing data', async () => {
  const denied = setup()
  await createConversation({ ...denied.ports, authorize: async (_, tool) => !tool }).handle(
    invocation,
  )
  assert.equal(denied.requests.length, 0)
  assert.match(denied.replies[0].content, /permiso/)

  const revoked = setup()
  let read = false
  await createConversation({
    ...revoked.ports,
    // Invocation check passes; once the collection was read, delivery is revoked.
    authorize: async (_, tool) => !!tool || !read,
    catalog: composeCapabilities({
      collection: bucketCollection('https://collection.example/', async () => {
        read = true
        return Response.json(['secreto'])
      }),
    }),
  }).handle(invocation)
  assert.equal(read, true)
  assert.equal(revoked.replies.length, 0)
})

test('attachments without an image loader are refused before the model', async () => {
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
      generate: chooses('collection_photo', {
        guildId: 'other',
        requester: 'owner',
        url: 'https://evil.example/',
      }),
    },
  }).handle({ ...invocation, content: 'Muéstrame uno de nuestros recuerdos en foto.' })
  assert.match(app.replies[0].content, /No pude consultar la colección de fotos/)
  assert.equal(app.requests.length, 0)
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
      RUNTIME_MODE: 'pilot',
      RUNTIME_CHANNEL_IDS: 'c1',
      BUCKET_URL: base,
    })
    const model = {
      generate: async ({ invocation, results }: { invocation: Invocation; results: unknown[] }) =>
        results.length
          ? { text: '', calls: [] }
          : {
              text: '',
              calls: [
                {
                  id: 'intent',
                  name: invocation.content.includes('foto')
                    ? 'collection_photo'
                    : 'collection_phrase',
                  input: {},
                },
              ],
            },
    }
    const build = (redis: Redis) =>
      composeConversation({
        client: client,
        config: config,
        redis: redis,
        model: model,
        discordFetch: async () => Response.json([]),
      })
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

test('collection cancellation stops a pending body read even when the transport ignores abort', async () => {
  const controller = new AbortController()
  let started!: () => void
  const reading = new Promise<void>((resolve) => {
    started = resolve
  })
  let cancelled = 0
  const collection = bucketCollection('https://collection.example/', async (_, init) => {
    assert.equal(init?.signal, controller.signal)
    return new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          started()
          return new Promise(() => {})
        },
        cancel() {
          cancelled++
        },
      }),
    )
  })!
  const result = collection.read('phrases.json', controller.signal)
  await reading
  controller.abort(new Error('invocation cancelled'))
  await assert.rejects(
    Promise.race([
      result,
      new Promise((_, reject) => setTimeout(() => reject(new Error('reader did not cancel')), 100)),
    ]),
    /invocation cancelled/,
  )
  assert.equal(cancelled, 1)
})

test('collection rejects chunked bytes above its limit and cancels the body before parsing', async () => {
  let cancelled = false
  const collection = bucketCollection(
    'https://collection.example/',
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(524288))
            controller.enqueue(new Uint8Array(1))
          },
          cancel() {
            cancelled = true
          },
        }),
      ),
  )!
  await assert.rejects(collection.read('phrases.json', new AbortController().signal), /too large/)
  assert.equal(cancelled, true)
})

test('a photo reply is only the bare image URL, even when the model adds text around it', async () => {
  const app = setup(['photos/gnomo.jpg'], 'collection_photo')
  await createConversation({
    ...app.ports,
    model: {
      generate: async () => ({
        text: '¡Aquí va una foto del Gnomo!',
        calls: [{ id: 'p', name: 'collection_photo', input: {} }],
      }),
    },
  }).handle({ ...invocation, content: 'mándame una foto del gnomo' })
  assert.deepEqual(
    app.replies.map((r) => r.content),
    ['https://collection.example/photos/gnomo.jpg'],
  )
})

test('a photo in a combined answer is sent as its own message, never inside the text', async () => {
  const app = setup(['photos/gnomo.jpg'])
  await createConversation({
    ...app.ports,
    model: {
      generate: async ({ results }): Promise<ModelTurn> =>
        results.length
          ? {
              text: 'Mira esta: https://collection.example/photos/gnomo.jpg y por acá todo bien.',
              calls: [],
            }
          : {
              text: '',
              calls: [
                { id: 'p', name: 'collection_photo', input: {} },
                { id: 's', name: 'runtime_status', input: {} },
              ],
            },
    },
  }).handle({ ...invocation, content: 'una foto del gnomo y cómo estás' })
  const contents = app.replies.map((r) => r.content)
  assert.equal(contents.length, 2)
  assert.doesNotMatch(contents[0], /https?:/)
  assert.match(contents[0], /todo bien/)
  assert.equal(contents[1], 'https://collection.example/photos/gnomo.jpg')
})
