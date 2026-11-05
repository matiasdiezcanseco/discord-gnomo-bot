import assert from 'node:assert/strict'
import { test } from 'node:test'
import Redis from 'ioredis'
import { randomUUID } from 'node:crypto'
import { redisClaims } from '../src/conversation/redis-claims'
import { createConversation } from '../src/conversation/harness'
import type { Invocation } from '../src/core/conversation/invocation'

test(
  'Redis atomically deduplicates concurrent events across clients and reconnects',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const url = process.env.T02_REDIS_URL!
    const namespace = `test:t02:${randomUUID()}`
    const first = new Redis(url),
      second = new Redis(url)
    const input: Invocation = {
      messageId: '1',
      guildId: 'g',
      channelId: 'c',
      requester: { id: 'u', username: 'Ana' },
      content: 'hola',
      createdAt: 0,
      attachments: [],
    }
    const replies: string[] = []
    const build = (client: Redis) =>
      createConversation({
        claim: redisClaims(client, namespace, 60),
        authorize: async () => true,
        model: {
          generate: async ({ invocation }) => ({ text: invocation.requester.id, calls: [] }),
        },
        reply: async (origin, reply) => {
          replies.push(`${origin.messageId}:${reply.content}`)
        },
      })
    try {
      await Promise.all([build(first).handle(input), build(second).handle(input)])
      assert.deepEqual(replies, ['1:u'])
      await first.quit()
      const restarted = new Redis(url)
      try {
        await build(restarted).handle(input)
        assert.equal(replies.length, 1)
      } finally {
        await restarted.quit()
      }
      await build(second).handle({
        ...input,
        messageId: '2',
        requester: { id: 'other', username: 'Luis' },
      })
      assert.deepEqual(replies, ['1:u', '2:other'])
    } finally {
      first.disconnect()
      await second.quit()
    }
  },
)

test(
  'an event can be processed again after its configured Redis retention expires',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const replies: string[] = []
    const invocation: Invocation = {
      messageId: 'expires',
      guildId: 'g',
      channelId: 'c',
      requester: { id: 'u', username: 'Ana' },
      content: 'hola',
      createdAt: 0,
      attachments: [],
    }
    const conversation = createConversation({
      claim: redisClaims(redis, `test:t02:expiry:${randomUUID()}`, 1),
      authorize: async () => true,
      model: { generate: async () => ({ text: 'Hola, Ana.', calls: [] }) },
      reply: async (_, reply) => {
        replies.push(reply.content)
      },
    })
    try {
      await conversation.handle(invocation)
      assert.deepEqual(replies, ['Hola, Ana.'])
      await new Promise((resolve) => setTimeout(resolve, 1100))
      await conversation.handle(invocation)
      assert.deepEqual(replies, ['Hola, Ana.', 'Hola, Ana.'])
    } finally {
      await redis.quit()
    }
  },
)
