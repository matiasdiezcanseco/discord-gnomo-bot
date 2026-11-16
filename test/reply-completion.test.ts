import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { defineCapability, type ReplyFile } from '../src/conversation/catalog'
import type { ModelTurn, ToolResult } from '../src/conversation/harness'
import { ReplyCompletion } from '../src/conversation/reply-completion'

const phrase = defineCapability({
  name: 'phrase',
  capability: 'collection.phrase',
  description: 'An exact phrase',
  scope: 'channel',
  effect: 'read',
  input: z.strictObject({}),
  output: z.string(),
  maxCalls: 1,
  maxResultChars: 500,
  available: async () => true,
  execute: async () => 'Así habla Gnomo.',
  verbatim: (result) => String(result.value ?? result.status),
})
const photo = defineCapability({ ...phrase, name: 'photo', standalone: true })
const read = defineCapability({ ...phrase, name: 'read', verbatim: undefined })
const write = defineCapability({
  ...read,
  name: 'save',
  effect: 'write',
  label: 'guardar el recuerdo',
})
const completion = new ReplyCompletion([phrase, photo, read, write])
const url = 'https://collection.example/gnomo.jpg'
const result = (
  name: string,
  value: unknown,
  status: ToolResult['status'] = 'success',
): ToolResult => ({
  id: name,
  name,
  status,
  value,
})
const turn = (...names: string[]): ModelTurn => ({
  text: '¡Aquí va!',
  calls: names.map((name) => ({ id: name, name, input: {} })),
})
const draft = { text: '', results: [], files: [], users: [], pendingWrite: false }
const image: ReplyFile = { name: 'image.png', attachment: Buffer.from('image') }
const voice: ReplyFile = {
  name: 'speech.ogg',
  attachment: Buffer.from('audio'),
  voice: { durationSecs: 1, waveform: 'AA==' },
}

test('verbatim-only turns preserve call order, suppress photo chatter, and render denials', () => {
  assert.equal(
    completion.finishTurn(turn('phrase', 'photo'), [
      result('photo', url),
      result('phrase', 'Exacta.'),
    ]),
    'Exacta.',
  )
  assert.equal(completion.finishTurn(turn('photo'), [result('photo', url)]), '')
  assert.equal(
    completion.finishTurn(turn('phrase'), [result('phrase', undefined, 'denied')]),
    '¡Aquí va!\ndenied',
  )
  assert.equal(
    completion.finishTurn(turn('phrase', 'read'), [result('phrase', 'Exacta.')]),
    undefined,
  )
  assert.equal(completion.finishTurn(turn('phrase'), []), undefined)
  assert.equal(completion.finishTurn(turn('read'), [result('read', 'dato')]), undefined)
})

test('synthesis restores exact text and removes repeated standalone URLs before arranging mixed files', async () => {
  let syntheses = 0
  const { messages, content } = await completion.complete(
    {
      ...draft,
      text: url,
      results: [result('phrase', 'Así habla Gnomo.'), result('photo', url), result('read', 'dato')],
      files: [voice, image, { ...voice, name: 'second.ogg' }],
      users: ['requested-user'],
    },
    async () => {
      syntheses++
      return `Resumen ${url} y ${url}`
    },
  )
  assert.equal(syntheses, 1)
  assert.deepEqual(
    messages.map((message) => message.content),
    ['Resumen y\nAsí habla Gnomo.', url, '', ''],
  )
  assert.deepEqual(
    messages.map((message) => message.files),
    [undefined, [image], [voice], [{ ...voice, name: 'second.ogg' }]],
  )
  for (const message of messages)
    assert.deepEqual(message.allowedMentions, {
      parse: [],
      users: ['requested-user'],
      roles: [],
      repliedUser: false,
    })
  assert.equal(content, `Resumen y\nAsí habla Gnomo.\n${url}`)
})

test('standalone-only and file-only replies need neither synthesis nor fallback chatter', async () => {
  let syntheses = 0
  const synthesize = async () => {
    syntheses++
    return 'Unnecessary synthesis'
  }
  const alone = await completion.complete(
    { ...draft, text: url, results: [result('photo', url)] },
    synthesize,
  )
  assert.deepEqual(
    alone.messages.map((message) => message.content),
    [url],
  )
  for (const files of [[image], [voice], [voice, image]]) {
    const completed = await completion.complete({ ...draft, files }, synthesize)
    assert.ok(completed.messages.every((message) => message.content === ''))
    assert.deepEqual(
      completed.messages.flatMap((message) => message.files ?? []),
      [...files.filter((file) => !file.voice), ...files.filter((file) => file.voice)],
    )
  }
  assert.equal(syntheses, 0)
})

test('failed synthesis falls back to confirmed evidence and labels without leaking IDs or claiming failed writes', async () => {
  let attempts = 0
  const { messages } = await completion.complete(
    {
      ...draft,
      failure: 'Se agotó el tiempo disponible antes de terminar.',
      pendingWrite: true,
      results: [
        result('save', { id: 'internal-write-id' }),
        result(
          'read',
          { title: 'Fuente confirmada', id: 'internal-read-id', coverage: 'internal', url },
          'partial',
        ),
        result('save', undefined, 'uncertain'),
        result('read', 'unconfirmed evidence', 'transient'),
      ],
    },
    async () => {
      attempts++
      throw new Error('model down')
    },
  )
  assert.equal(attempts, 1)
  assert.equal(messages.length, 1)
  assert.match(messages[0].content, /Se agotó el tiempo/)
  assert.match(messages[0].content, /alcancé a guardar el recuerdo/)
  assert.match(messages[0].content, /Fuente confirmada/)
  assert.ok(messages[0].content.includes(url))
  assert.match(messages[0].content, /estado incierto/)
  assert.doesNotMatch(messages[0].content, /internal|unconfirmed|[{}]/)
})

test('an omitted phrase survives failed synthesis without duplication of existing exact text', async () => {
  const results = [result('phrase', 'Exacta.')]
  const failed = await completion.complete({ ...draft, results }, async () => {
    throw new Error('down')
  })
  assert.equal(failed.messages[0].content, 'Exacta.')
  let syntheses = 0
  const existing = await completion.complete(
    { ...draft, results, text: 'Dijo: Exacta.' },
    async () => {
      syntheses++
      return 'Unnecessary synthesis'
    },
  )
  assert.equal(existing.messages[0].content, 'Dijo: Exacta.')
  assert.equal(syntheses, 0)
})

test('unconfirmed results do not trigger synthesis or expose their values', async () => {
  let calls = 0
  const { messages } = await completion.complete(
    {
      ...draft,
      results: [result('read', 'secret', 'denied'), result('save', 'secret', 'uncertain')],
    },
    async () => {
      calls++
      return 'should not run'
    },
  )
  assert.equal(calls, 0)
  assert.match(messages[0].content, /No pude completar toda la petición/)
  assert.match(messages[0].content, /estado incierto/)
  assert.doesNotMatch(messages[0].content, /secret|alcancé/)
})

test('completion splits long text without breaking a source and keeps attachments on the last message', async () => {
  const source = '[Fuente](https://example.test/source)'
  const { messages } = await completion.complete({
    ...draft,
    text: `${'x'.repeat(1990)} ${source}`,
    files: [image, voice],
  })
  assert.equal(messages.length, 3)
  assert.ok(messages.every((message) => message.content.length <= 2000))
  assert.equal(messages[1].content, source)
  assert.equal(messages[0].files, undefined)
  assert.deepEqual(messages[1].files, [image])
  assert.deepEqual(messages[2].files, [voice])
})

test('an oversized source produces a visible notice while preserving standalone output and generated files', async () => {
  const { messages } = await completion.complete({
    ...draft,
    text: `https://example.test/${'x'.repeat(2000)}`,
    results: [result('photo', url)],
    files: [image, voice],
  })
  assert.match(messages[0].content, /fuente excede/)
  assert.equal(messages[1].content, url)
  assert.deepEqual(messages[1].files, [image])
  assert.deepEqual(messages[2].files, [voice])
})
