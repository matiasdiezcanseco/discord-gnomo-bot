import assert from 'node:assert/strict'
import { test } from 'node:test'
import { respondToInvocation, type Invocation } from '../src/core/conversation/invocation'
import { normalizeInvocation } from '../src/modules/discord/normalize-invocation'

test('only an explicit member mention in the configured server becomes an invocation', () => {
  const event = {
    id: 'm1',
    guildId: 'g1',
    channelId: 'thread1',
    createdTimestamp: 123,
    content: '<@!99> hola <@42>',
    author: { id: 'u1', username: 'Ana', bot: false },
    attachments: new Map(),
  }
  assert.equal(normalizeInvocation({ ...event, content: 'hola' }, 'g1', '99'), null)
  assert.equal(
    normalizeInvocation({ ...event, author: { ...event.author, bot: true } }, 'g1', '99'),
    null,
  )
  assert.equal(normalizeInvocation(event, 'other', '99'), null)
  assert.equal(normalizeInvocation({ ...event, guildId: null }, 'g1', '99'), null)
  assert.equal(normalizeInvocation(event, undefined, '99'), null)
  assert.equal(normalizeInvocation(event, 'g1', undefined), null)
  assert.deepEqual(normalizeInvocation(event, 'g1', '99'), {
    messageId: 'm1',
    guildId: 'g1',
    channelId: 'thread1',
    createdAt: 123,
    content: 'hola <@42>',
    requester: { id: 'u1', username: 'Ana' },
    attachments: [],
  })
})

test('a normalized invocation keeps its provenance through the visible reply', async () => {
  const invocation: Invocation = {
    messageId: 'message-1',
    guildId: 'guild-1',
    channelId: 'thread-1',
    requester: { id: 'member-1', username: 'Ana' },
    content: '¿Qué ves?',
    createdAt: 1793890800000,
    attachments: [
      {
        id: 'attachment-1',
        url: 'https://example.test/photo.png',
        name: 'photo.png',
        contentType: 'image/png',
        size: 123,
      },
    ],
  }
  const replies: unknown[] = []
  await respondToInvocation(invocation, {
    async respond(input) {
      return {
        text: `${input.requester.username}: ${input.content} (${input.attachments[0].name})`,
        success: true,
      }
    },
    async reply(origin, response) {
      replies.push({ origin, response })
    },
  })
  assert.deepEqual(replies, [
    {
      origin: {
        messageId: 'message-1',
        guildId: 'guild-1',
        channelId: 'thread-1',
        requester: { id: 'member-1', username: 'Ana' },
        content: '¿Qué ves?',
        createdAt: 1793890800000,
        attachments: [
          {
            id: 'attachment-1',
            url: 'https://example.test/photo.png',
            name: 'photo.png',
            contentType: 'image/png',
            size: 123,
          },
        ],
      },
      response: { text: 'Ana: ¿Qué ves? (photo.png)', success: true },
    },
  ])
})

test('normalization retains image and non-image attachments with the event timestamp and thread', async () => {
  const replies: unknown[] = []
  const invocation = normalizeInvocation(
    {
      id: 'm2',
      guildId: 'g1',
      channelId: 'thread2',
      createdTimestamp: 456,
      content: '<@99> mira los archivos',
      author: { id: 'u2', username: 'Luis', bot: false },
      attachments: new Map([
        [
          'a1',
          {
            id: 'a1',
            url: 'https://example.test/image.png',
            name: 'image.png',
            contentType: 'image/png',
            size: 10,
          },
        ],
        [
          'a2',
          {
            id: 'a2',
            url: 'https://example.test/data.txt',
            name: 'data.txt',
            contentType: null,
            size: 20,
          },
        ],
      ]),
    },
    'g1',
    '99',
  )
  assert.ok(invocation)
  await respondToInvocation(invocation, {
    async respond() {
      return { text: 'Recibido', success: true }
    },
    async reply(origin) {
      replies.push(origin)
    },
  })
  assert.deepEqual(replies, [
    {
      messageId: 'm2',
      guildId: 'g1',
      channelId: 'thread2',
      createdAt: 456,
      content: 'mira los archivos',
      requester: { id: 'u2', username: 'Luis' },
      attachments: [
        {
          id: 'a1',
          url: 'https://example.test/image.png',
          name: 'image.png',
          contentType: 'image/png',
          size: 10,
        },
        {
          id: 'a2',
          url: 'https://example.test/data.txt',
          name: 'data.txt',
          contentType: null,
          size: 20,
        },
      ],
    },
  ])
})
