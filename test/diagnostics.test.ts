import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { describeError, redact, reportError, setDiagnosticsSink } from '../src/diagnostics'
import { createConversation, type Trace } from '../src/conversation/harness'
import { Catalog, defineCapability } from '../src/conversation/catalog'
import { traceLevel } from '../src/modules/services/logger/conversation-trace'
import { runtimeSummary } from '../src/modules/config/runtime-summary'
import type { Invocation } from '../src/core/conversation/invocation'

test('redact removes credentials, API keys and Discord tokens from log text', () => {
  // Assembled at runtime so secret scanners do not mistake the fixture for a real token.
  const fakeDiscordToken = [
    'MTAxMjM0NTY3ODkwMTIzNDU2',
    'Gabcde',
    'abcdefghijklmnopqrstuvwxyz0123',
  ].join('.')
  const text = redact(
    `connect postgresql://owner:hunter2@ep-x.neon.tech/db failed; Authorization: Bearer abc.def; key sk-proj-abcdefghijklmnop; tvly-abcdefghijkl; Bot ${fakeDiscordToken}; https://x.test/?api_key=zzz&q=1`,
  )
  for (const secret of [
    'hunter2',
    'abc.def',
    'sk-proj-abcdefghijklmnop',
    'tvly-abcdefghijkl',
    'Gabcde',
    'zzz',
  ])
    assert.doesNotMatch(text, new RegExp(secret.replace(/[.]/g, '\\.')), secret)
  assert.match(text, /ep-x\.neon\.tech/)
  assert.match(text, /q=1/)
})

test('describeError keeps class, code, HTTP status, provider body and cause chain', () => {
  const root = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
    code: 'ECONNREFUSED',
  })
  const api = Object.assign(
    new Error('Incorrect API key provided: sk-abcdefghijkl', { cause: root }),
    {
      name: 'AI_APICallError',
      statusCode: 401,
      responseBody: '{"error":{"message":"Incorrect API key provided: sk-abcdefghijkl"}}',
    },
  )
  const summary = describeError(api)
  assert.equal(summary.name, 'AI_APICallError')
  assert.equal(summary.status, 401)
  assert.doesNotMatch(JSON.stringify(summary), /sk-abcdefghijkl/)
  assert.match(summary.response!, /Incorrect API key/)
  assert.equal(summary.cause?.code, 'ECONNREFUSED')
  assert.deepEqual(describeError('plain'), { name: 'string', message: 'plain' })
})

test('reportError reaches the sink and never throws', () => {
  const seen: unknown[] = []
  setDiagnosticsSink((scope, error, context) => seen.push({ scope, error, context }))
  reportError('memory.query', new Error('relation "pilot_memories" does not exist'), { op: 'save' })
  setDiagnosticsSink(() => {
    throw new Error('broken sink')
  })
  reportError('anything', new Error('x'))
  setDiagnosticsSink(() => undefined)
  assert.deepEqual(seen, [
    {
      scope: 'memory.query',
      error: { name: 'Error', message: 'relation "pilot_memories" does not exist' },
      context: { op: 'save' },
    },
  ])
})

const invocation: Invocation = {
  messageId: 'm1',
  guildId: 'g',
  channelId: 'c',
  requester: { id: 'u', username: 'Ana' },
  content: 'hola',
  createdAt: 0,
  attachments: [],
}

test('traces explain stopped turns, rejected and failed tools, and model metadata', async () => {
  const traces: Trace[] = []
  const tool = (name: string, execute: () => Promise<unknown>) =>
    defineCapability({
      name,
      description: name,
      capability: 'runtime.status',
      scope: 'channel',
      effect: 'read',
      input: z.strictObject({ n: z.number() }),
      output: z.string(),
      maxCalls: 1,
      maxResultChars: 1000,
      available: async () => true,
      execute,
    })
  let turn = 0
  await createConversation({
    catalog: new Catalog([
      tool('boom', async () => {
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
      }),
      tool('soft', async () => 'unavailable: almacenamiento no disponible.'),
    ]),
    authorize: async () => true,
    claim: async () => true,
    reply: async () => undefined,
    trace: (trace) => traces.push(trace),
    model: {
      generate: async () => {
        turn++
        if (turn === 1)
          return {
            text: '',
            calls: [
              { id: 'a', name: 'boom', input: { n: 1 } },
              { id: 'b', name: 'soft', input: { n: 1 } },
              { id: 'c', name: 'missing', input: {} },
              { id: 'd', name: 'soft', input: { n: 'x' } },
            ],
            meta: { finishReason: 'tool-calls', inputTokens: 10, outputTokens: 5 },
          }
        throw Object.assign(new Error('Rate limit reached'), { statusCode: 429 })
      },
    },
  }).handle(invocation)
  const find = (event: string, tool?: string) =>
    traces.find((t) => t.event === event && (!tool || t.tool === tool))
  assert.equal(find('received')?.contentLength, 4)
  assert.equal(find('received')?.content, undefined, 'content is opt-in')
  assert.equal(find('model_finished')?.model?.finishReason, 'tool-calls')
  assert.deepEqual(find('model_finished')?.toolCalls, ['boom', 'soft', 'missing', 'soft'])
  assert.equal(find('tool_failed', 'boom')?.error?.code, 'ECONNRESET')
  assert.equal(find('tool_outcome', 'soft')?.status, 'unavailable')
  assert.match(find('tool_rejected', 'unknown')?.detail ?? '', /unknown tool/)
  assert.ok(
    traces.some((t) => t.event === 'tool_rejected' && /n: invalid_type/.test(t.detail ?? '')),
  )
  assert.equal(find('stopped')?.error?.status, 429)
  assert.equal(traceLevel(find('stopped')!), 'error')
  assert.equal(traceLevel(find('tool_rejected', 'unknown')!), 'warn')
  assert.equal(traceLevel(find('received')!), 'info')
})

test('opt-in content tracing includes redacted request and reply text', async () => {
  const traces: Trace[] = []
  await createConversation({
    authorize: async () => true,
    claim: async () => true,
    reply: async () => undefined,
    trace: (trace) => traces.push(trace),
    traceContent: true,
    model: { generate: async () => ({ text: 'Hola, causa.', calls: [] }) },
  }).handle({ ...invocation, content: 'mi clave es sk-abcdefghijklmn' })
  assert.equal(traces.find((t) => t.event === 'received')?.content, 'mi clave es sk-***')
  assert.equal(traces.find((t) => t.event === 'delivered')?.reply, 'Hola, causa.')
})

test('the startup summary reports what is disabled without exposing values', () => {
  const values: Record<string, string> = {
    RUNTIME_MODE: 'guild',
    OPENAI_API_KEY: 'sk-secret-value',
    DATABASE_URL: 'postgresql://u:p@localhost/db',
    REDIS_URL: 'redis://:pw@localhost:6379/1',
  }
  const summary = runtimeSummary({ get: ((key: string) => values[key]) as never })
  assert.doesNotMatch(JSON.stringify(summary), /sk-secret|u:p@|:pw@/)
  assert.equal(summary.configured.OPENAI_API_KEY, true)
  assert.ok(summary.disabled.includes('memory (MEMORY_OWNER_ID missing/invalid)'))
  assert.ok(summary.disabled.includes('phrases/photos/birthdays (BUCKET_URL)'))
})
