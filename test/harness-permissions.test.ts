import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { ConfigService } from '@nestjs/config'
import type { Client } from 'discord.js'
import { composePilot } from '../src/modules/discord/pilot-conversation'

test(
  'composed pilot checks effective requester and bot permissions using authenticated IDs',
  { skip: !process.env.T02_REDIS_URL },
  async () => {
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
    const config = new ConfigService({ GUILD_ID: 'g', CONVERSATION_PILOT_CHANNEL_IDS: 'c' })
    const conversation = composePilot(client, config, redis, undefined, {
      generate: async ({ results }) => {
        turns++
        return results.length
          ? { text: String(results[0].status), calls: [] }
          : { text: '', calls: [{ id: 'probe', name: 'pilot_status', input: {} }] }
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
