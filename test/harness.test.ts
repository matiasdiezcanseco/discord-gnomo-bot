import { z } from 'zod'
import { Catalog, defineCapability, partialResult } from '../src/conversation/catalog'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createConversation } from '../src/conversation/harness'
import type { Invocation } from '../src/core/conversation/invocation'

export const invocation: Invocation = {
  messageId: '1',
  guildId: 'g',
  channelId: 'c',
  requester: { id: 'u', username: 'Ana' },
  content: 'hola',
  createdAt: 0,
  attachments: [],
}

test('new conversation replies to the originating invocation without legacy context', async () => {
  const replies: string[] = []
  const conversation = createConversation({
    model: {
      async generate() {
        return { text: 'Hola, soy Gnomo.', calls: [] }
      },
    },
    authorize: async () => true,
    claim: async () => true,
    reply: async (origin, message) => {
      replies.push(`${origin.messageId}:${message.content}`)
    },
  })
  await conversation.handle(invocation)
  assert.deepEqual(replies, ['1:Hola, soy Gnomo.'])
})

test('a registered controlled capability executes with authenticated scope and returns its result', async () => {
  const effects: string[] = []
  const replies: string[] = []
  let turn = 0
  const tool = defineCapability({
    name: 'probe',
    description: 'Controlled probe',
    capability: 'probe.read',
    scope: 'channel',
    effect: 'read',
    input: z.strictObject({ value: z.string() }),
    output: z.string(),
    maxCalls: 1,
    maxResultChars: 200,
    available: async () => true,
    async execute(args, context) {
      effects.push(`${context.invocation.requester.id}:${args.value}`)
      return 'confirmed'
    },
  })
  const conversation = createConversation({
    catalog: new Catalog([tool]),
    model: {
      async generate(input) {
        return turn++ === 0
          ? { text: '', calls: [{ id: 'a', name: 'probe', input: { value: 'ok' } }] }
          : { text: String(input.results[0].value), calls: [] }
      },
    },
    authorize: async () => true,
    claim: async () => true,
    reply: async (_, message) => {
      replies.push(message.content)
    },
  })
  await conversation.handle(invocation)
  assert.deepEqual(effects, ['u:ok'])
  assert.deepEqual(replies, ['confirmed'])
})

test('tool denials, unavailable dependencies and forged identity never produce effects', async () => {
  let effects = 0
  const results: string[] = []
  const probe = defineCapability({
    name: 'probe',
    description: 'probe',
    capability: 'probe',
    scope: 'channel',
    effect: 'write',
    input: z.strictObject({ value: z.string() }),
    output: z.string(),
    maxCalls: 1,
    maxResultChars: 200,
    available: async () => true,
    execute: async () => {
      effects++
      return 'ok'
    },
  })
  for (const mode of ['forged', 'denied', 'unavailable']) {
    let step = 0
    await createConversation({
      catalog: new Catalog([{ ...probe, available: async () => mode !== 'unavailable' }]),
      model: {
        async generate(input) {
          if (step++ === 0)
            return {
              text: '',
              calls: [
                {
                  id: 'x',
                  name: 'probe',
                  input:
                    mode === 'forged'
                      ? { value: 'x', requester: 'owner', channelId: 'elsewhere' }
                      : { value: 'x' },
                },
              ],
            }
          results.push(input.results[0].status)
          return { text: input.results[0].status, calls: [] }
        },
      },
      authorize: async (_, tool) => !tool || mode !== 'denied',
      claim: async () => true,
      reply: async () => {},
    }).handle(invocation)
  }
  assert.equal(effects, 0)
  assert.deepEqual(results, ['invalid', 'denied', 'unavailable'])
  assert.throws(() => new Catalog([probe, probe]), /duplicate/)
})

test('repeated tool attempts consume one shared eight-call budget including model turns', async () => {
  let effects = 0
  const replies: string[] = []
  const probe = defineCapability({
    name: 'probe',
    description: 'probe',
    capability: 'probe',
    scope: 'channel',
    effect: 'read',
    input: z.strictObject({}),
    output: z.string(),
    maxCalls: 8,
    maxResultChars: 200,
    available: async () => true,
    execute: async () => {
      effects++
      return 'verified'
    },
  })
  await createConversation({
    catalog: new Catalog([probe]),
    model: {
      async generate() {
        return {
          text: '',
          calls: Array.from({ length: 10 }, (_, i) => ({
            id: String(i),
            name: 'probe',
            input: {},
          })),
        }
      },
    },
    authorize: async () => true,
    claim: async () => true,
    reply: async (_, reply) => {
      replies.push(reply.content)
    },
  }).handle(invocation)
  assert.equal(effects, 7)
  assert.match(replies[0], /presupuesto/)
})

class ManualClock {
  time = 0
  timers = new Map<() => void, number>()
  now = () => this.time
  schedule = (callback: () => void, delay: number) => {
    this.timers.set(callback, this.time + delay)
    return () => {
      this.timers.delete(callback)
    }
  }
  advance(ms: number) {
    this.time += ms
    for (const [callback, at] of this.timers)
      if (at <= this.time) {
        this.timers.delete(callback)
        callback()
      }
  }
}

test('external work is cancelled at twelve seconds and a visible notice is delivered', async () => {
  const clock = new ManualClock()
  const replies: string[] = []
  let signal: AbortSignal | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const running = createConversation({
    clock,
    model: {
      async generate(input) {
        signal = input.signal
        started()
        return new Promise(() => {})
      },
    },
    authorize: async () => true,
    claim: async () => true,
    reply: async (_, reply) => {
      replies.push(reply.content)
    },
  }).handle(invocation)
  await ready
  clock.advance(12000)
  await running
  assert.equal(signal?.aborted, true)
  assert.match(replies[0], /tiempo/)
  assert.equal(clock.time, 12000)
})

test('long replies preserve complete source links and suppress every unapproved mention', async () => {
  const replies: { content: string; allowedMentions: unknown }[] = []
  const url = 'https://example.test/source?q=reference'
  const text = 'Explicación. '.repeat(240) + `[Fuente completa](${url}) @everyone <@&123> <@42>`
  await createConversation({
    model: { generate: async () => ({ text, calls: [] }) },
    authorize: async () => true,
    claim: async () => true,
    reply: async (_, reply) => {
      replies.push(reply)
    },
  }).handle(invocation)
  assert.ok(replies.length > 1)
  assert.ok(replies.every((r) => r.content.length <= 2000))
  assert.ok(replies.some((r) => r.content.includes(`[Fuente completa](${url})`)))
  assert.ok(
    replies.every(
      (r) =>
        JSON.stringify(r.allowedMentions) ===
        JSON.stringify({ parse: [], users: [], roles: [], repliedUser: false }),
    ),
  )
})

test('queued invocations consume their original deadline and never start after expiry', async () => {
  const clock = new ManualClock()
  const starts: string[] = [],
    replies: string[] = []
  let ready!: () => void
  const started = new Promise<void>((resolve) => {
    ready = resolve
  })
  const conversation = createConversation({
    clock,
    concurrency: 1,
    model: {
      async generate({ invocation }) {
        starts.push(invocation.messageId)
        ready()
        return new Promise(() => {})
      },
    },
    authorize: async () => true,
    claim: async () => true,
    reply: async (origin, reply) => {
      replies.push(`${origin.messageId}:${reply.content}`)
    },
  })
  const first = conversation.handle(invocation)
  await started
  const second = conversation.handle({ ...invocation, messageId: '2' })
  await new Promise((resolve) => setImmediate(resolve))
  clock.advance(12000)
  await Promise.all([first, second])
  assert.deepEqual(starts, ['1'])
  assert.equal(replies.length, 2)
})

test('timeout preserves confirmed sources and marks an in-flight write uncertain without retry', async () => {
  const clock = new ManualClock(),
    replies: string[] = []
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const read = defineCapability({
    name: 'source',
    description: 'source',
    capability: 'read',
    scope: 'channel',
    effect: 'read',
    input: z.strictObject({}),
    output: z.string(),
    maxCalls: 1,
    maxResultChars: 200,
    available: async () => true,
    execute: async () => 'https://example.test/confirmed',
  })
  const write = defineCapability({
    ...read,
    name: 'write',
    effect: 'write',
    execute: async () => {
      started()
      return new Promise<string>(() => {})
    },
  })
  const running = createConversation({
    clock,
    catalog: new Catalog([read, write]),
    model: {
      generate: async () => ({
        text: '',
        calls: [
          { id: 'r', name: 'source', input: {} },
          { id: 'w', name: 'write', input: {} },
        ],
      }),
    },
    authorize: async () => true,
    claim: async () => true,
    reply: async (_, reply) => {
      replies.push(reply.content)
    },
  }).handle(invocation)
  await ready
  clock.advance(12000)
  await running
  assert.match(replies[0], /https:\/\/example.test\/confirmed/)
  assert.match(replies[0], /incierto/)
})

test('permission revoked during generation prevents delivery of model content', async () => {
  let allowed = true
  const replies: string[] = []
  await createConversation({
    model: {
      generate: async () => {
        allowed = false
        return { text: 'sensitive result', calls: [] }
      },
    },
    authorize: async () => allowed,
    claim: async () => true,
    reply: async (_, reply) => {
      replies.push(reply.content)
    },
  }).handle(invocation)
  assert.ok(!replies.join('').includes('sensitive'))
})

test('an uncertain write cannot be retried by another model tool call', async () => {
  let effects = 0
  const probe = defineCapability({
    name: 'write',
    description: 'write',
    capability: 'write',
    scope: 'channel',
    effect: 'write',
    input: z.strictObject({}),
    output: z.string(),
    maxCalls: 8,
    maxResultChars: 100,
    available: async () => true,
    execute: async () => {
      effects++
      throw new Error('connection lost after write')
    },
  })
  await createConversation({
    catalog: new Catalog([probe]),
    model: {
      generate: async () => ({
        text: '',
        calls: [{ id: String(Math.random()), name: 'write', input: {} }],
      }),
    },
    authorize: async () => true,
    claim: async () => true,
    reply: async () => {},
  }).handle(invocation)
  assert.equal(effects, 1)
})

test('capabilities report partial coverage without presenting it as a complete success', async () => {
  const statuses: string[] = []
  const probe = defineCapability({
    name: 'partial',
    description: 'partial',
    capability: 'read',
    scope: 'channel',
    effect: 'read',
    input: z.strictObject({}),
    output: z.string(),
    maxCalls: 1,
    maxResultChars: 100,
    available: async () => true,
    execute: async () => partialResult('Only accessible results'),
  })
  await createConversation({
    catalog: new Catalog([probe]),
    model: {
      generate: async ({ results }) => {
        if (results.length) {
          statuses.push(results[0].status)
          return { text: 'Cobertura parcial.', calls: [] }
        }
        return { text: '', calls: [{ id: 'a', name: 'partial', input: {} }] }
      },
    },
    authorize: async () => true,
    claim: async () => true,
    reply: async () => {},
  }).handle(invocation)
  assert.deepEqual(statuses, ['partial'])
})
