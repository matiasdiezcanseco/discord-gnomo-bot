import { z } from 'zod'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Catalog, defineCapability } from '../src/conversation/catalog'
import { createConversation, looksLikeJson, type ModelInput } from '../src/conversation/harness'
import { capabilityAllowed } from '../src/conversation/execution-policy'
import { composeCapabilities } from '../src/conversation/capabilities'
import type { Invocation } from '../src/core/conversation/invocation'

const invocation: Invocation = {
  messageId: '1',
  guildId: 'g',
  channelId: 'c',
  requester: { id: 'u', username: 'Ana' },
  content: 'guarda esto',
  createdAt: 0,
  attachments: [],
}
const write = defineCapability({
  name: 'memory_save',
  description: 'save',
  capability: 'memory.save',
  scope: 'channel',
  effect: 'write',
  input: z.strictObject({}),
  output: z.strictObject({ id: z.string(), message: z.string() }),
  maxCalls: 1,
  maxResultChars: 500,
  available: async () => true,
  execute: async () => ({ id: '123', message: 'guardado' }),
})

function run(
  generate: (
    input: ModelInput,
  ) => Promise<{ text: string; calls: [] | { id: string; name: string; input: unknown }[] }>,
  synthesisTimeoutMs?: number,
) {
  const replies: string[] = []
  const app = createConversation({
    catalog: new Catalog([write]),
    model: { generate },
    authorize: async () => true,
    claim: async () => true,
    synthesisTimeoutMs,
    reply: async (_, r) => {
      replies.push(r.content)
    },
  })
  return { replies, handle: () => app.handle(invocation) }
}

test('JSON detection covers raw objects, arrays and fenced blocks only', () => {
  assert.equal(looksLikeJson('{"id":"1","message":"x"}'), true)
  assert.equal(looksLikeJson('```json\n[1,2]\n```'), true)
  assert.equal(looksLikeJson('{ya pues} causa'), false)
  assert.equal(looksLikeJson('Listo, guardado.'), false)
})

test('an empty final answer (e.g. a discarded JSON dump) gets a tool-less synthesis turn', async () => {
  const seen: ModelInput[] = []
  const { replies, handle } = run(async (input) => {
    seen.push(input)
    if (input.finalize) return { text: 'Listo, ya lo guardé.', calls: [] }
    return input.results.length
      ? { text: '', calls: [] }
      : { text: '', calls: [{ id: 'a', name: 'memory_save', input: {} }] }
  }, 1000)
  await handle()
  assert.deepEqual(replies, ['Listo, ya lo guardé.'])
  assert.equal(seen.at(-1)?.tools.length, 0)
})

test('a failure after a confirmed write never dumps tool payloads', async () => {
  let step = 0
  const { replies, handle } = run(async (input) => {
    if (input.finalize) throw new Error('model down')
    if (step++ === 0) return { text: '', calls: [{ id: 'a', name: 'memory_save', input: {} }] }
    throw new Error('model down')
  }, 1000)
  await handle()
  assert.equal(replies.length, 1)
  assert.doesNotMatch(replies[0], /[{}]|"id"/)
  assert.match(replies[0], /alcancé a guardar el recuerdo/)
})

test('the reminder tool is offered by intent, not by keywords in the request', () => {
  const reminder = composeCapabilities().tools.find((tool) => tool.name === 'reminder_create')!
  for (const content of [
    'crea un recordatorio para mi en 1 minuto',
    'oye, en 10 min me pasas la voz',
  ])
    assert.equal(capabilityAllowed({ ...invocation, content }, reminder), true, content)
  assert.equal('direct' in reminder, false)
})

test('model-chosen reminder time is validated against the request time', async () => {
  const reminder = composeCapabilities().tools.find((tool) => tool.name === 'reminder_create')!
  const context = {
    invocation: { ...invocation, createdAt: Date.parse('2026-11-07T23:16:00Z') },
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    external: <T>(work: () => Promise<T>) => work(),
  }
  const message = async (input: unknown) =>
    ((await reminder.execute(input, context)) as { message: string }).message
  // No store configured: a valid request reaches the storage step.
  assert.match(
    await message({ dueAt: '2026-11-07T18:17:00-05:00', text: 'algo' }),
    /no disponibles/,
  )
  assert.match(await message({ dueAt: '2026-11-07 18:17', text: 'algo' }), /no disponibles/)
  assert.match(await message({ dueAt: '2026-11-07T18:00:00-05:00', text: 'algo' }), /futura/)
  assert.match(await message({ dueAt: '2028-01-01T00:00:00-05:00', text: 'algo' }), /futura/)
  assert.match(
    await message({ dueAt: '2026-11-07T18:17:00-05:00', text: '<@1> hola' }),
    /menciones/,
  )
})

test('memory writes are chosen by intent and require model-supplied content or selector', () => {
  const tools = composeCapabilities().tools
  const tool = (name: string) => tools.find((entry) => entry.name === name)!
  for (const name of ['memory_save', 'memory_search', 'memory_update', 'memory_forget']) {
    assert.equal('direct' in tool(name), false, name)
    assert.equal(
      capabilityAllowed({ ...invocation, content: 'acuérdate que juego Valorant' }, tool(name)),
      true,
    )
  }
  assert.equal(tool('memory_save').input.safeParse({}).success, false)
  assert.equal(tool('memory_save').input.safeParse({ content: 'Ana juega Valorant' }).success, true)
  assert.equal(tool('memory_save').input.safeParse({ content: 'x', key: 'a;b' }).success, false)
  assert.equal(tool('memory_update').input.safeParse({ selector: 'bebida' }).success, false)
  assert.equal(tool('memory_forget').input.safeParse({ selector: 'bebida' }).success, true)
})
