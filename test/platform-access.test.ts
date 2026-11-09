import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelType, type Client } from 'discord.js'
import { discordPlatform } from '../src/modules/discord/conversation-composition'

test('access reads members from the gateway cache instead of forcing REST lookups', async () => {
  const memberLookups: unknown[] = []
  const channelLookups: unknown[] = []
  const client = {
    user: { id: 'bot' },
    guilds: {
      fetch: async () => ({
        channels: {
          fetch: async (_id: string, options: unknown) => {
            channelLookups.push(options)
            return {
              isTextBased: () => true,
              isThread: () => false,
              type: ChannelType.GuildText,
              permissionsFor: () => ({ has: () => true }),
            }
          },
        },
        members: {
          fetch: async (options: { user: string; force?: boolean }) => {
            memberLookups.push(options)
            return { id: options.user }
          },
        },
      }),
    },
  } as unknown as Client
  const allowed = await discordPlatform(client).access({
    messageId: '1',
    guildId: 'g',
    channelId: 'c',
    requester: { id: 'u', username: 'Ana' },
    content: 'hola',
    createdAt: 0,
    attachments: [],
  })
  assert.equal(allowed, true)
  assert.deepEqual(memberLookups, [{ user: 'u' }, { user: 'bot' }])
  // Channel overwrites stay a fresh read.
  assert.deepEqual(channelLookups, [{ force: true }])
})
