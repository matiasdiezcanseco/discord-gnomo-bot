import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MockLanguageModelV3 } from 'ai/test'
import { aiSdkModel } from '../src/conversation/ai-sdk-model'
import { createConversation } from '../src/conversation/harness'

test('AI SDK adapter delivers model text through the new invocation path without credentials', async () => {
  const replies: string[] = []
  const model = new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: 'text', text: 'Hola, causa.' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  })
  await createConversation({
    model: aiSdkModel(model),
    authorize: async () => true,
    claim: async () => true,
    reply: async (_, reply) => {
      replies.push(reply.content)
    },
  }).handle({
    messageId: '1',
    guildId: 'g',
    channelId: 'c',
    requester: { id: 'u', username: 'Ana' },
    content: 'hola',
    createdAt: 0,
    attachments: [],
  })
  assert.deepEqual(replies, ['Hola, causa.'])
})

test('controlled capability crosses AI SDK, catalog, executor and visible reply', async () => {
  const { composeCapabilities } = await import('../src/conversation/capabilities')
  let generated = 0
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content:
        generated++ === 0
          ? [
              {
                type: 'tool-call' as const,
                toolCallId: 'probe',
                toolName: 'pilot_status',
                input: '{}',
              },
            ]
          : [{ type: 'text' as const, text: 'Harness listo.' }],
      finishReason: {
        unified: generated === 1 ? ('tool-calls' as const) : ('stop' as const),
        raw: 'stop',
      },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  })
  const replies: string[] = [],
    statuses: string[] = []
  await createConversation({
    model: aiSdkModel(model),
    catalog: composeCapabilities({  }),
    authorize: async () => true,
    claim: async () => true,
    trace: (event) => {
      if (event.event === 'tool_finished') statuses.push(event.status!)
    },
    reply: async (_, reply) => {
      replies.push(reply.content)
    },
  }).handle({
    messageId: '1',
    guildId: 'g',
    channelId: 'c',
    requester: { id: 'u', username: 'Ana' },
    content: 'prueba el harness',
    createdAt: 0,
    attachments: [],
  })
  assert.deepEqual(replies, ['Harness listo.'])
  assert.deepEqual(statuses, ['success'])
})
