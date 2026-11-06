import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MockLanguageModelV3 } from 'ai/test'
import { aiSdkModel } from '../src/conversation/ai-sdk-model'
import { createConversation } from '../src/conversation/harness'
import { normalizeInvocation } from '../src/modules/discord/normalize-invocation'

function setup() {
  const model = new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: 'text', text: 'Hola Ana, soy Gnomo.' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  })
  const replies: unknown[] = []
  const conversation = createConversation({
    model: aiSdkModel(model),
    authorize: async () => true,
    claim: async () => true,
    reply: async (_, reply) => {
      replies.push(reply)
    },
  })
  const event = {
    id: 'm1',
    guildId: 'g1',
    channelId: 'thread1',
    createdTimestamp: 123,
    content: '<@99> hola',
    author: { id: 'u1', username: 'Ana', bot: false },
    attachments: new Map(),
  }
  return { model, replies, conversation, event }
}
test('an explicit invocation completes conversation without Discord or model credentials', async () => {
  const app = setup()
  await app.conversation.handle(normalizeInvocation(app.event, 'g1', '99')!)
  assert.deepEqual(app.replies, [
    {
      content: 'Hola Ana, soy Gnomo.',
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    },
  ])
})
test('ambient messages, bots and other servers cause no response or model work', async () => {
  const app = setup()
  for (const event of [
    { ...app.event, content: 'hola' },
    { ...app.event, guildId: 'other' },
    { ...app.event, author: { ...app.event.author, bot: true } },
  ]) {
    const invocation = normalizeInvocation(event, 'g1', '99')
    if (invocation) await app.conversation.handle(invocation)
  }
  assert.deepEqual(app.replies, [])
  assert.deepEqual(app.model.doGenerateCalls, [])
})
