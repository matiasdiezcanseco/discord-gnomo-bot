import assert from 'node:assert/strict'
import { test } from 'node:test'
import Redis from 'ioredis'
import { randomUUID } from 'node:crypto'
import { createConversation, type ModelInput, type Reply } from '../src/conversation/harness'
import { composeCapabilities } from '../src/conversation/capabilities'
import { ImageRejected, type ImageGenerator } from '../src/conversation/image-generation'
import { redisCooldown, type RequesterCooldown } from '../src/conversation/paid-generation'
import type { Invocation } from '../src/core/conversation/invocation'

const base: Invocation = {
  messageId: 'm1',
  guildId: 'g',
  channelId: 'c',
  requester: { id: 'u', username: 'Ana' },
  content: 'dibújame un gnomo surfeando',
  createdAt: Date.parse('2026-11-08T15:00:00Z'),
  attachments: [],
}

/** Stands in for the LLM: asks for one image, then phrases the tool result. */
const model = {
  generate: async ({ results }: ModelInput) =>
    results.length
      ? { text: (results[0].value as { message?: string })?.message ?? 'falló', calls: [] }
      : {
          text: '',
          calls: [{ id: 'i', name: 'image_generate', input: { prompt: 'un gnomo surfeando' } }],
        },
}

function fakeGenerator(behaviour: () => Promise<void> = async () => {}) {
  const prompts: string[] = []
  const generator: ImageGenerator = {
    async generate(prompt) {
      prompts.push(prompt)
      await behaviour()
      return { data: Buffer.from('jpeg-bytes'), mediaType: 'image/jpeg', extension: 'jpg' }
    },
  }
  return { generator, prompts }
}

/** In-memory twin of the Redis quota, with a controllable clock. */
function memoryQuota(windowMs = 3600_000) {
  let now = 0
  const taken = new Map<string, { until: number; token: number }>()
  let tokens = 0
  const quota: RequesterCooldown = {
    async reserve(invocation) {
      const key = `${invocation.guildId}:${invocation.requester.id}`
      const slot = taken.get(key)
      if (slot && slot.until > now) return { granted: false, retryInMs: slot.until - now }
      const token = ++tokens
      taken.set(key, { until: now + windowMs, token })
      return {
        granted: true,
        release: async () => {
          if (taken.get(key)?.token === token) taken.delete(key)
        },
      }
    },
  }
  return { quota, advance: (ms: number) => (now += ms) }
}

function app(generator: ImageGenerator, quota: RequesterCooldown) {
  const replies: Reply[] = []
  const conversation = createConversation({
    catalog: composeCapabilities({ images: { generator, cooldown: quota } }),
    authorize: async () => true,
    claim: async () => true,
    model,
    reply: async (_origin, reply) => {
      replies.push(reply)
    },
  })
  return {
    replies,
    handle: (invocation: Partial<Invocation> = {}) =>
      conversation.handle({ ...base, ...invocation }),
  }
}

test('image generation is a bounded, labelled write', () => {
  const [tool] = composeCapabilities({ images: {} }).tools.filter(
    (t) => t.name === 'image_generate',
  )
  assert.equal(tool.effect, 'write')
  assert.equal(tool.maxCalls, 1)
  assert.equal(tool.label, 'crear la imagen')
})

test('a generated image is attached to the reply, never passed through the model', async () => {
  const { generator, prompts } = fakeGenerator()
  const { quota } = memoryQuota()
  const { replies, handle } = app(generator, quota)
  await handle()
  assert.deepEqual(prompts, ['un gnomo surfeando'])
  assert.equal(replies.length, 1)
  assert.match(replies[0].content, /Imagen creada/)
  assert.equal(replies[0].files?.length, 1)
  assert.equal(replies[0].files![0].name, 'gnomo-m1.jpg')
  assert.equal(replies[0].files![0].attachment.toString(), 'jpeg-bytes')
})

test('each requester gets at most one image per hour', async () => {
  const { generator, prompts } = fakeGenerator()
  const { quota, advance } = memoryQuota()
  const { replies, handle } = app(generator, quota)
  await handle({ messageId: 'a' })
  advance(20 * 60_000)
  await handle({ messageId: 'b' })
  assert.equal(prompts.length, 1, 'second request within the hour spends no credit')
  assert.equal(replies[1].files, undefined)
  assert.match(replies[1].content, /1 imagen por hora/)
  assert.match(replies[1].content, /40 min/)
  // Another person is not affected by Ana's quota.
  await handle({ messageId: 'c', requester: { id: 'v', username: 'Luis' } })
  assert.equal(prompts.length, 2)
  advance(40 * 60_000)
  await handle({ messageId: 'd' })
  assert.equal(prompts.length, 3, 'the slot frees once the hour has passed')
  assert.equal(replies.at(-1)!.files?.length, 1)
})

test('a provider refusal gives the slot back; other failures keep it', async () => {
  let fail: Error | undefined = new ImageRejected('policy')
  const { generator, prompts } = fakeGenerator(async () => {
    if (fail) throw fail
  })
  const { quota } = memoryQuota()
  const { replies, handle } = app(generator, quota)
  await handle({ messageId: 'a' })
  assert.match(replies[0].content, /no cuenta para su límite/)
  assert.equal(replies[0].files, undefined)
  fail = new Error('provider timeout')
  await handle({ messageId: 'b' })
  assert.equal(prompts.length, 2, 'the refusal did not consume the hour')
  assert.equal(replies[1].files, undefined)
  fail = undefined
  await handle({ messageId: 'c' })
  assert.equal(
    prompts.length,
    2,
    'an uncertain failure may have spent credit, so the hour stays used',
  )
  assert.match(replies[2].content, /1 imagen por hora/)
})

test('without a reachable quota no image is generated', async () => {
  const { generator, prompts } = fakeGenerator()
  const quota: RequesterCooldown = {
    reserve: async () => {
      throw new Error('redis down')
    },
  }
  const { replies, handle } = app(generator, quota)
  await handle()
  assert.equal(prompts.length, 0)
  assert.match(replies[0].content, /límite de imágenes/)
})

test(
  'Redis enforces one image per requester per window across clients',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const url = process.env.T02_REDIS_URL!
    const namespace = `test:images:${randomUUID()}`
    const first = new Redis(url),
      second = new Redis(url)
    try {
      const a = redisCooldown(first, 1, namespace)
      const b = redisCooldown(second, 1, namespace)
      const results = await Promise.all([a.reserve(base), b.reserve(base)])
      assert.equal(results.filter((r) => r.granted).length, 1, 'concurrent requests: only one wins')
      const denied = results.find((r) => !r.granted)
      assert.ok(denied && !denied.granted && denied.retryInMs > 0 && denied.retryInMs <= 1000)
      assert.equal(
        (await a.reserve({ ...base, requester: { id: 'v', username: 'Luis' } })).granted,
        true,
      )
      const winner = results.find((r) => r.granted)
      if (winner?.granted) await winner.release()
      const again = await b.reserve(base)
      assert.equal(again.granted, true, 'a released slot is free again')
      if (again.granted) {
        // A stale release must not free a slot taken by someone else's reservation.
        await new Promise((resolve) => setTimeout(resolve, 1100))
        const fresh = await a.reserve(base)
        assert.equal(fresh.granted, true, 'the window expired')
        await again.release()
        assert.equal((await b.reserve(base)).granted, false)
      }
    } finally {
      await first.quit()
      await second.quit()
    }
  },
)
