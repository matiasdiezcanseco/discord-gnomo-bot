import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'
import pino from 'pino'
import { MessageHandlerService } from '../src/modules/discord/message-handler.service'
import { LoggerService } from '../src/modules/services/logger/logger.service'
import type { DiscordService } from '../src/modules/discord/discord.service'
import type { OrchestratorService } from '../src/core/orchestrator/orchestrator.service'
import type { RedisHistoryService } from '../src/modules/services/redis/redis-history.service'
import type { Message } from 'discord.js'

test('pilot channel routes through the only receiver and never invokes legacy orchestration', async () => {
  const replies: unknown[] = []
  const handler = new MessageHandlerService(
    new ConfigService({ GUILD_ID: 'g', CONVERSATION_PILOT_CHANNEL_IDS: 'c' }),
    { getClient: () => ({ user: { id: '99' } }) } as DiscordService,
    {
      handle: async () => {
        throw new Error('legacy invoked')
      },
    } as unknown as OrchestratorService,
    {} as RedisHistoryService,
    new LoggerService(pino({ level: 'silent' })),
    {
      handle: async (invocation, reply) => {
        await reply!(invocation, {
          content: 'Piloto',
          allowedMentions: { parse: [], roles: [], users: [], repliedUser: false },
        })
      },
    },
  )
  await handler.handleMessage({
    id: '1',
    guildId: 'g',
    channelId: 'c',
    content: '<@99> hola',
    createdTimestamp: 0,
    author: { id: 'u', username: 'Ana', bot: false },
    attachments: new Map(),
    channel: { type: 0 },
    reply: async (message: unknown) => {
      replies.push(message)
    },
  } as unknown as Message)
  assert.deepEqual(replies, [
    { content: 'Piloto', allowedMentions: { parse: [], roles: [], users: [], repliedUser: false } },
  ])
})
