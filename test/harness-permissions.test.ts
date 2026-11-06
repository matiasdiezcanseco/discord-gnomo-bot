import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { ConfigService } from '@nestjs/config'
import type { Client } from 'discord.js'
import { composeConversation } from '../src/modules/discord/conversation-composition'

test(
  'composed pilot checks effective requester and bot permissions using authenticated IDs',
  { skip: !process.env.T02_REDIS_URL },
  async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('[]'))
    const redis = new Redis(process.env.T02_REDIS_URL!)
    const replies: string[] = [],
      lookups: string[] = []
    let canRead = true,
      canSend = true,
      privateThread = false,
      turns = 0
    const client = {
      user: { id: 'bot' },
      guilds: {
        fetch: async (guildId: string) => {
          lookups.push(guildId)
          return {
            channels: {
              fetch: async (channelId: string) => {
                lookups.push(channelId)
                return {
                  isTextBased: () => true,
                  isThread: () => privateThread,
                  type: 12,
                  members: {
                    fetch: async () => {
                      throw new Error('not a thread member')
                    },
                  },
                  permissionsFor: (member: { id: string }) => ({
                    has: () => (member.id === 'bot' ? canSend : canRead),
                  }),
                }
              },
            },
            members: {
              fetch: async ({ user }: { user: string }) => {
                lookups.push(user)
                return { id: user }
              },
            },
          }
        },
      },
    } as unknown as Client
    const config = new ConfigService({
      GUILD_ID: 'g',
      RUNTIME_MODE: 'pilot',
      RUNTIME_CHANNEL_IDS: 'c',
    })
    const conversation = composeConversation({
      client: client,
      config: config,
      redis: redis,
      model: {
        generate: async ({ results }) => {
          turns++
          return results.length
            ? { text: String(results[0].status), calls: [] }
            : { text: '', calls: [{ id: 'probe', name: 'runtime_status', input: {} }] }
        },
      },
    })
    const invocation = {
      messageId: randomUUID(),
      guildId: 'g',
      channelId: 'c',
      requester: { id: 'u', username: 'Ana' },
      content: 'prueba',
      createdAt: 0,
      attachments: [],
    }
    const reply = async (_: unknown, message: { content: string }) => {
      replies.push(message.content)
    }
    try {
      await conversation.handle(invocation, reply)
      assert.deepEqual(replies, ['success'])
      assert.ok(
        lookups.length <= 24,
        `catalog discovery repeated permission reads: ${lookups.length}`,
      )
      assert.ok(lookups.every((id) => ['g', 'c', 'u', 'bot'].includes(id)))
      for (const permission of ['requester', 'bot']) {
        canRead = permission !== 'requester'
        canSend = permission !== 'bot'
        await conversation.handle({ ...invocation, messageId: randomUUID() }, reply)
      }
      canRead = true
      canSend = true
      privateThread = true
      await conversation.handle({ ...invocation, messageId: randomUUID() }, reply)
      assert.equal(turns, 2)
      assert.deepEqual(replies, ['success'])
    } finally {
      await redis.quit()
    }
  },
)

for (const stage of ['guild', 'channel', 'members'])
  test(
    `expired ${stage} authorization stops chained Discord lookups while timeout delivery and another invocation retain their own budgets`,
    { skip: !process.env.T02_REDIS_URL },
    async () => {
      const redis = new Redis(process.env.T02_REDIS_URL!)
      let expire!: () => void, finish!: () => void, began!: () => void
      let lateQueries = 0,
        normalQueries = 0,
        first = true,
        now = 0
      const started = new Promise<void>((r) => {
        began = r
      })
      const gate = new Promise<void>((r) => {
        finish = r
      })
      const pause = async () => {
        began()
        await gate
      }
      const channel = (late: boolean) => ({
        isTextBased: () => true,
        isThread: () => true,
        type: 12,
        archived: false,
        locked: false,
        members: {
          fetch: async () => {
            if (late) lateQueries++
            return {}
          },
        },
        permissionsFor: () => ({ has: () => true }),
      })
      const guild = (late: boolean) => ({
        channels: {
          fetch: async () => {
            if (late && stage === 'guild') lateQueries++
            else if (late && stage === 'channel') await pause()
            else normalQueries++
            return channel(late)
          },
        },
        members: {
          fetch: async ({ user }: { user: string }) => {
            if (late && stage === 'channel') lateQueries++
            if (late && stage === 'members') await pause()
            return { id: user }
          },
        },
      })
      const client = {
        user: { id: 'bot' },
        guilds: {
          fetch: async () => {
            if (first) {
              first = false
              if (stage === 'guild') await pause()
              return guild(true)
            }
            return guild(false)
          },
        },
      } as unknown as Client
      const replies: string[] = []
      const app = composeConversation({
        client,
        redis,
        config: new ConfigService({
          GUILD_ID: 'g',
          RUNTIME_MODE: 'pilot',
          RUNTIME_CHANNEL_IDS: 'c',
        }),
        clock: {
          now: () => now,
          schedule: (callback, delay) => {
            if (delay === 12000) expire = callback
            return () => {}
          },
        },
        discordFetch: async () => new Response('[]'),
        model: { generate: async () => ({ text: 'Hola', calls: [] }) },
      })
      const invocation = {
        messageId: randomUUID(),
        guildId: 'g',
        channelId: 'c',
        requester: { id: 'u', username: 'Ana' },
        content: 'hola',
        createdAt: 0,
        attachments: [],
      }
      try {
        const pending = app.handle(invocation, async (_, reply) => {
          replies.push(reply.content)
        })
        await started
        now = 12001
        expire()
        await pending
        assert.match(replies[0], /agotó el tiempo/)
        finish()
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(lateQueries, 0, 'expired authorization must never start a subsequent query')
        await app.handle({ ...invocation, messageId: randomUUID() }, async (_, reply) => {
          replies.push(reply.content)
        })
        assert.equal(replies[1], 'Hola')
        assert.ok(
          normalQueries > 0,
          'fresh delivery and independent invocation revalidate permissions',
        )
      } finally {
        finish?.()
        await redis.quit()
      }
    },
  )
