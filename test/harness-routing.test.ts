import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'
import pino from 'pino'
import { MessageHandlerService } from '../src/modules/discord/message-handler.service'
import { LoggerService } from '../src/modules/services/logger/logger.service'
import type { DiscordService } from '../src/modules/discord/discord.service'
import type { Message } from 'discord.js'

test('rollout expands, pauses and resumes the sole receiver without legacy fallback', async () => {
  const replies: unknown[] = []
  const config = new ConfigService({ GUILD_ID: 'g', RUNTIME_MODE: 'pilot', RUNTIME_CHANNEL_IDS: 'c' })
  const handler = new MessageHandlerService(
    config,
    { getClient: () => ({ user: { id: '99' } }) } as DiscordService,
    new LoggerService(pino({ level: 'silent' })),
    { handle: async (invocation, reply) => {
      await reply!(invocation, { content: 'Gnomo', allowedMentions: { parse: [], roles: [], users: [], repliedUser: false } })
    } },
  )
  const message = (channelId: string, content = '<@99> hola') => ({
    id: '1', guildId: 'g', channelId, content, createdTimestamp: 0,
    author: { id: 'u', username: 'Ana', bot: false }, attachments: new Map(),
    channel: { type: 0 }, reply: async (value: unknown) => { replies.push(value) },
  }) as unknown as Message
  await handler.handleMessage(message('c', 'ambient'))
  await handler.handleMessage(message('other'))
  assert.equal(replies.length, 0)
  await handler.handleMessage(message('c'))
  assert.equal(replies.length, 1)
  config.set('RUNTIME_MODE', 'paused')
  await handler.handleMessage(message('c'))
  assert.equal(replies.length, 1)
  config.set('RUNTIME_MODE', 'guild')
  await handler.handleMessage(message('other'))
  assert.deepEqual(replies, Array(2).fill({ content: 'Gnomo', allowedMentions: { parse: [], roles: [], users: [], repliedUser: false } }))
})
