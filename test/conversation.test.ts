import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { MockLanguageModelV3 } from 'ai/test'
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import { Collection, type Message, type Guild, type Attachment } from 'discord.js'
import pino from 'pino'
import { MessageHandlerService } from '../src/modules/discord/message-handler.service'
import { DiscordService } from '../src/modules/discord/discord.service'
import { OrchestratorService } from '../src/core/orchestrator/orchestrator.service'
import { PromptBuilder } from '../src/core/orchestrator/prompt-builder'
import { MessageBuilder } from '../src/core/orchestrator/message-builder'
import type { BotTool } from '../src/core/tools/tool.interface'
import { ToolRegistryService } from '../src/core/tools/tool-registry.service'
import { RedisHistoryService } from '../src/modules/services/redis/redis-history.service'
import { LoggerService } from '../src/modules/services/logger/logger.service'

export function modelResult(text: string): LanguageModelV3GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  }
}

export function harness(model: MockLanguageModelV3) {
  const config = new ConfigService({ GUILD_ID: 'g1' })
  const logger = new LoggerService(pino({ level: 'silent' }))
  const history = new RedisHistoryService(null, config, logger)
  const capabilities: BotTool[] = []
  const tools = new ToolRegistryService(capabilities)
  const orchestrator = new OrchestratorService(
    [],
    tools,
    new PromptBuilder(),
    new MessageBuilder(),
    config,
    logger,
    model,
  )
  const discord = { getClient: () => ({ user: { id: '99', username: 'Gnomo' } }) } as DiscordService
  const handler = new MessageHandlerService(config, discord, orchestrator, history, logger)
  const replies: { messageId: string; text: string }[] = []
  function event(
    content: string,
    overrides: Partial<Pick<Message, 'id' | 'guildId' | 'guild' | 'author' | 'attachments'>> = {},
  ): Message {
    // Discord is the external boundary; no client is logged in or Nest app bootstrapped.
    return {
      id: 'm1',
      guildId: 'g1',
      channelId: 'thread1',
      createdTimestamp: 123,
      content,
      author: { id: 'u1', username: 'Ana', bot: false },
      guild: { id: 'g1' } as Guild,
      channel: { id: 'thread1', type: 11, async sendTyping() {} },
      mentions: { has: () => true, members: new Collection() },
      attachments: new Collection(),
      async reply(this: { id: string }, text: string) {
        replies.push({ messageId: this.id, text })
      },
      ...overrides,
    } as unknown as Message
  }
  return { handler, replies, event, config, logger, tools, capabilities }
}

test('an explicit invocation completes the existing conversation without Discord or model credentials', async () => {
  const model = new MockLanguageModelV3({ doGenerate: modelResult('Hola Ana, soy Gnomo.') })
  const app = harness(model)
  await app.handler.handleMessage(app.event('<@99> hola'))
  assert.deepEqual(app.replies, [{ messageId: 'm1', text: 'Hola Ana, soy Gnomo.' }])
})

test('ambient messages, bot messages, and other servers cause no response or external work', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error('Ignored event reached model')
    },
  })
  const app = harness(model)
  await app.handler.handleMessage(app.event('hola'))
  await app.handler.handleMessage(
    app.event('<@99> hola', {
      author: { id: 'bot', username: 'Other', bot: true } as Message['author'],
    }),
  )
  await app.handler.handleMessage(
    app.event('<@99> hola', { guildId: 'other', guild: { id: 'other' } as Guild }),
  )
  assert.deepEqual(app.replies, [])
  assert.deepEqual(model.doGenerateCalls, [])
})

import axios, { type CreateAxiosDefaults } from 'axios'
import { mock } from 'node:test'
import { PhraseTool } from '../src/core/tools/content/phrase.tool'
import { ImageTool } from '../src/core/tools/content/image.tool'
import { BucketService } from '../src/modules/services/bucket/bucket.service'
import { LookupUserTool } from '../src/core/tools/discord/lookup-user.tool'
import { QueryMemoryTool } from '../src/core/tools/memory/query-memory.tool'
import { SaveMemoryTool } from '../src/core/tools/memory/save-memory.tool'
import { MemoryService } from '../src/modules/services/memory/memory.service'
import { ReminderTool } from '../src/core/tools/reminder/reminder.tool'
import { ReminderService } from '../src/modules/services/reminder/reminder.service'

function toolModel(name: string, input: object = {}) {
  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      const last = prompt.at(-1)
      if (last?.role === 'tool') {
        const result = last.content.find((part) => part.type === 'tool-result')
        if (!result) throw new Error('Missing tool result')
        return modelResult(JSON.stringify(result.output))
      }
      return {
        ...modelResult(''),
        content: [
          { type: 'tool-call', toolCallId: 'call-1', toolName: name, input: JSON.stringify(input) },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      }
    },
  })
}

test('a phrase request returns a saved phrase from the collection', async () => {
  const app = harness(toolModel('generatePhrase'))
  const create = axios.create.bind(axios)
  const transport = mock.method(axios, 'create', (options: CreateAxiosDefaults) =>
    create({
      ...options,
      adapter: async (config) => ({
        data: ['Soy pequeño pero peligroso.'],
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }),
    }),
  )
  try {
    app.capabilities.push(new PhraseTool(new BucketService(app.config, app.logger)))
    await app.handler.handleMessage(app.event('<@99> dame una frase'))
    assert.match(app.replies[0].text, /Soy pequeño pero peligroso\./)
  } finally {
    transport.mock.restore()
  }
})

test('a photo request returns a URL from the existing collection', async () => {
  const app = harness(toolModel('generateImage'))
  app.config.set('BUCKET_URL', 'https://collection.example/')
  const create = axios.create.bind(axios)
  const transport = mock.method(axios, 'create', (options: CreateAxiosDefaults) =>
    create({
      ...options,
      adapter: async (config) => ({
        data: ['gnomo.jpg'],
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }),
    }),
  )
  try {
    app.capabilities.push(new ImageTool(new BucketService(app.config, app.logger)))
    await app.handler.handleMessage(app.event('<@99> una foto'))
    assert.match(app.replies[0].text, /https:\/\/collection.example\/gnomo.jpg/)
  } finally {
    transport.mock.restore()
  }
})

test('a member can be resolved by nickname from Discord data', async () => {
  const app = harness(toolModel('lookupUser', { name: 'Anita' }))
  app.capabilities.push(new LookupUserTool(app.logger))
  const guild = {
    id: 'g1',
    members: {
      cache: new Collection([
        ['42', { id: '42', user: { username: 'Ana' }, displayName: 'Anita' }],
      ]),
    },
  } as unknown as Guild
  await app.handler.handleMessage(app.event('<@99> busca a Anita', { guild }))
  assert.match(app.replies[0].text, /<@42>/)
  assert.match(app.replies[0].text, /Anita/)
})

for (const operation of ['saveMemory', 'queryMemory']) {
  test(`unavailable memory is reported without claiming success: ${operation}`, async () => {
    const app = harness(
      toolModel(
        operation,
        operation === 'saveMemory'
          ? { key: 'juego_ana', content: 'Ana juega ajedrez' }
          : { query: 'juego de Ana' },
      ),
    )
    const memory = new MemoryService(app.config, app.logger, null)
    app.capabilities.push(new SaveMemoryTool(memory), new QueryMemoryTool(memory))
    await app.handler.handleMessage(app.event('<@99> recuerda el juego de Ana'))
    assert.match(app.replies[0].text, /Servicio de memoria no disponible/)
    assert.match(app.replies[0].text, /"success":false/)
  })
}

test('an unavailable reminder store does not produce a false confirmation', async () => {
  const app = harness(
    toolModel('setReminder', { timeExpression: 'en 2 minutos', reminderMessage: 'jugar' }),
  )
  app.capabilities.push(
    new ReminderTool(new ReminderService(null, app.config, app.logger), app.config, app.logger),
  )
  await app.handler.handleMessage(app.event('<@99> recuérdame jugar en 2 minutos'))
  assert.match(app.replies[0].text, /Servicio de recordatorios no disponible/)
  assert.match(app.replies[0].text, /"success":false/)
})

import { ReminderCheckTask } from '../src/modules/schedule/reminder-check.task'
import { BirthdayCheckTask } from '../src/modules/schedule/birthday-check.task'
import type IORedis from 'ioredis'

test('a due reminder notifies its saved requester in its saved channel and leaves the due list', async () => {
  const app = harness(new MockLanguageModelV3())
  const notices: string[] = []
  let pending = true
  // Redis protocol fake for characterization only, not evidence of transaction/concurrency correctness.
  const redis = {
    async zrangebyscore() {
      return pending ? ['r1'] : []
    },
    async get() {
      return JSON.stringify({
        id: 'r1',
        userId: '42',
        username: 'Ana',
        channelId: 'thread1',
        message: 'jugar',
        dueTime: 1,
        createdAt: 0,
      })
    },
    async zrem() {
      pending = false
    },
    async del() {},
  } as unknown as IORedis
  const reminders = new ReminderService(redis, app.config, app.logger)
  const discord = {
    getClient: () => ({
      channels: {
        cache: new Map([
          [
            'thread1',
            {
              type: 0,
              guildId: 'g1',
              async send(text: string) {
                notices.push(text)
              },
            },
          ],
        ]),
      },
    }),
  } as unknown as DiscordService
  await new ReminderCheckTask(discord, reminders, app.config, app.logger).handleReminderCheck()
  assert.deepEqual(notices, ['<@42> ¡Recordatorio! jugar'])
  assert.deepEqual(await reminders.getDueReminders(Date.now()), [])
})

test('existing birthdays notify the configured channel on the matching day', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T17:00:00Z') })
  const app = harness(new MockLanguageModelV3())
  app.config.set('GNOMOS_CHANNEL_ID', 'birthdays')
  const notices: string[] = []
  const create = axios.create.bind(axios)
  const transport = mock.method(axios, 'create', (options: CreateAxiosDefaults) =>
    create({
      ...options,
      adapter: async (config) => ({
        data: [
          { id: '42', name: 'Ana', date: '11-05' },
          { id: '43', name: 'Luis', date: '11-06' },
        ],
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }),
    }),
  )
  try {
    const discord = {
      getChannel: (id: string) =>
        id === 'birthdays'
          ? {
              type: 0,
              async send(text: string) {
                notices.push(text)
              },
            }
          : undefined,
    } as unknown as DiscordService
    await new BirthdayCheckTask(
      discord,
      new BucketService(app.config, app.logger),
      app.config,
      app.logger,
    ).handleBirthdayCheck()
    assert.deepEqual(notices, ['<@42> Feliz cumpleaños Ana! 🎉🎉🎉'])
  } finally {
    transport.mock.restore()
  }
})

import { WebSearchTool } from '../src/core/tools/search/web-search.tool'

test('web information reaches the reply with its source via a controlled external response', async () => {
  const app = harness(toolModel('webSearch', { query: 'noticias de Lima' }))
  app.config.set('TAVILY_API_KEY', 'test-only-not-a-credential')
  const transport = mock.method(axios, 'post', async () => ({
    data: {
      images: [],
      results: [
        {
          title: 'Noticia de Lima',
          content: 'Se abre un parque.',
          url: 'https://news.example/parque',
        },
      ],
    },
  }))
  try {
    app.capabilities.push(new WebSearchTool(app.config, app.logger))
    await app.handler.handleMessage(app.event('<@99> noticias de Lima'))
    assert.match(app.replies[0].text, /Se abre un parque/)
    assert.match(app.replies[0].text, /https:\/\/news.example\/parque/)
  } finally {
    transport.mock.restore()
  }
})

test('an attached image is available to the model when composing the visible response', async () => {
  const model = new MockLanguageModelV3({
    supportedUrls: { 'image/*': [/^https:\/\/images.example\//] },
    doGenerate: async ({ prompt }) => {
      const message = prompt.find((part) => part.role === 'user')
      const image =
        message?.role === 'user' ? message.content.find((part) => part.type === 'file') : undefined
      return modelResult(
        image?.type === 'file' && image.data instanceof URL
          ? `Veo la imagen ${image.data.href}`
          : 'No recibí imagen',
      )
    },
  })
  const app = harness(model)
  await app.handler.handleMessage(
    app.event('<@99> ¿Qué ves?', {
      attachments: new Collection([
        [
          'a1',
          {
            id: 'a1',
            url: 'https://images.example/gnomo.png',
            name: 'gnomo.png',
            contentType: 'image/png',
            size: 123,
          } as Attachment,
        ],
      ]),
    }),
  )
  assert.deepEqual(app.replies, [
    { messageId: 'm1', text: 'Veo la imagen https://images.example/gnomo.png' },
  ])
})
