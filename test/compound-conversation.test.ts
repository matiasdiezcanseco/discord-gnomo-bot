import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { createConversation, type Trace } from '../src/conversation/harness'
import { Catalog, defineCapability } from '../src/conversation/catalog'
import { composeCapabilities } from '../src/conversation/capabilities'
import { discordHistory } from '../src/modules/discord/channel-history'
import type { Client } from 'discord.js'

const origin = {
  messageId: 't14',
  guildId: 'g',
  channelId: 'c',
  requester: { id: 'u', username: 'Ana' },
  content: 'consulta las dos fuentes y compáralas',
  createdAt: 0,
  attachments: [],
}

test('four dependent reads with subcalls leave the fifth model step for useful synthesis', async () => {
  const replies: string[] = [],
    traces: Trace[] = []
  const tool = defineCapability({
    name: 'read',
    description: 'read',
    capability: 'read',
    effect: 'read',
    scope: 'channel',
    input: z.strictObject({}),
    output: z.string(),
    maxCalls: 4,
    maxResultChars: 100,
    available: async () => true,
    execute: async (_, context) => context.external(async () => 'source confirmed'),
  })
  await createConversation({
    catalog: new Catalog([tool]),
    claim: async () => true,
    authorize: async () => true,
    trace: (t) => traces.push(t),
    reply: async (_, r) => {
      replies.push(r.content)
    },
    model: {
      generate: async ({ results }) =>
        results.length < 4
          ? { text: '', calls: [{ id: String(results.length), name: 'read', input: {} }] }
          : { text: results.map((r) => r.value).join('; '), calls: [] },
    },
  }).handle(origin)
  assert.equal(replies[0], 'source confirmed; source confirmed; source confirmed; source confirmed')
  assert.equal(traces.at(-1)?.calls, 8)
  assert.equal(traces.at(-1)?.steps, 5)
})

test('independent reads start together and both contribute to the visible answer', async () => {
  const replies: string[] = []
  let release!: () => void
  const both = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = 0
  const tools = ['history', 'news'].map((name) =>
    defineCapability({
      name,
      description: name,
      capability: name,
      effect: 'read',
      scope: 'channel',
      input: z.strictObject({}),
      output: z.string(),
      maxCalls: 1,
      maxResultChars: 100,
      available: async () => true,
      execute: async () => {
        if (++started === 2) release()
        await both
        return name === 'news' ? 'https://example.org/news' : 'Ana: torneo'
      },
    }),
  )
  await createConversation({
    catalog: new Catalog(tools),
    claim: async () => true,
    authorize: async () => true,
    reply: async (_, r) => {
      replies.push(r.content)
    },
    model: {
      generate: async ({ results }) =>
        results.length
          ? { text: results.map((r) => r.value).join('\n'), calls: [] }
          : { text: '', calls: tools.map((t) => ({ id: t.name, name: t.name, input: {} })) },
    },
  }).handle(origin)
  assert.equal(replies[0], 'Ana: torneo\nhttps://example.org/news')
})

test('conversation plus news preserves actual channel evidence when news stalls at the common deadline', async () => {
  let time = 0
  let timeout = () => {}
  let ready!: () => void
  const confirmed = new Promise<void>((resolve) => {
    ready = resolve
  })
  let searchSignal: AbortSignal | undefined
  let generations = 0
  const replies: string[] = []
  const history = discordHistory(
    { token: 'controlled' } as Client,
    async () => true,
    async () =>
      Response.json([
        {
          id: 'previous',
          channel_id: 'c',
          author: { id: 'ana', username: 'Ana' },
          content: 'El torneo es de Valorant.',
          timestamp: '2026-11-04T00:00:00Z',
        },
        {
          id: 'foreign',
          channel_id: 'other',
          author: { id: 'other', username: 'Other' },
          content: 'FOREIGN SECRET',
          timestamp: '2026-11-04T00:00:00Z',
        },
      ]),
    false,
  )
  const app = createConversation({
    clock: {
      now: () => time,
      schedule: (callback) => {
        timeout = callback
        return () => {}
      },
    },
    catalog: composeCapabilities({
      history: history,
      search: {
        search: async (_, context) =>
          context.external(
            () =>
              new Promise((_, reject) => {
                searchSignal = context.signal
                context.signal.addEventListener('abort', () => reject(Error('cancelled')), {
                  once: true,
                })
              }),
          ),
      },
    }),
    claim: async () => true,
    authorize: async () => true,
    trace: (event) => {
      if (event.event === 'tool_finished' && event.tool === 'messages_history') ready()
    },
    model: {
      generate: async () => {
        generations++
        return {
          text: '',
          calls: [
            {
              id: 'news',
              name: 'news_search',
              input: {
                query: 'torneo Valorant',
                period: { startDate: '2026-11-01', endDate: '2026-11-05' },
              },
            },
            { id: 'history', name: 'messages_history', input: { limit: 10 } },
          ],
        }
      },
    },
    reply: async (_, r) => {
      replies.push(r.content)
    },
  })
  const running = app.handle({
    ...origin,
    content: 'consulta la conversación y busca noticias del torneo',
    createdAt: Date.parse('2026-11-05T00:00:00Z'),
  })
  await confirmed
  time = 12000
  timeout()
  await running
  assert.equal(searchSignal?.aborted, true)
  assert.equal(generations, 1)
  assert.match(replies.join(''), /El torneo es de Valorant/)
  assert.match(replies.join(''), /Ana/)
  assert.doesNotMatch(replies.join(''), /FOREIGN SECRET/)
  assert.match(replies.join(''), /tiempo/)
})
