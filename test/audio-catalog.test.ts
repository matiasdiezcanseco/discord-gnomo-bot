import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Pool } from 'pg'
import { audioCatalog } from '../src/conversation/audio-catalog'
import { composeCapabilities } from '../src/conversation/capabilities'
import type { MemoryEmbedding } from '../src/conversation/explicit-memory'
import { createConversation, type ModelTurn, type Reply } from '../src/conversation/harness'
import { encodeOggOpus } from '../src/conversation/ogg-opus'
import type { Invocation } from '../src/core/conversation/invocation'
import type { RequesterCooldown } from '../src/conversation/paid-generation'
import type { VoicePlaybackDependencies } from '../src/conversation/voice-playback'
import { migrateMemoryDatabase } from '../src/database/migrate'

const dbTest = { skip: !process.env.T10_DATABASE_URL }
const call = (name: string, input: unknown) => ({ id: randomUUID(), name, input })
const saveInput = {
  source: 'generated',
  title: 'El grito del lunes',
  description: 'Gnomo celebra el fin de la partida.',
  tags: ['Victoria'],
}
const spokenText = 'La misión terminó, causa.'
const voice = { durationSecs: 1, waveform: '/wCA' }
const owner = { id: '100000000000000002', username: 'owner' }
const generateAndSave = (input = saveInput, text = spokenText) => [
  call('speech_generate', { text }),
  call('audio_save', input),
]

async function withCatalog(
  run: (fixture: {
    pool: Pool
    objects: Map<string, Uint8Array>
    bytes: Buffer
    ask(
      content: string,
      calls: ModelTurn['calls'],
      overrides?: Partial<Invocation>,
    ): Promise<Reply[]>
    invocation: Invocation
    uploads: string[]
    removals: { key: string; catalogEntryExists: boolean }[]
  }) => Promise<void>,
  options: {
    embedding?: MemoryEmbedding
    location?: VoicePlaybackDependencies['location']
    savedCooldown?: RequesterCooldown
    speechCooldown?: RequesterCooldown
    sequential?: boolean
    reauthorize?: () => Promise<boolean>
    failRemoval?: boolean
  } = {},
) {
  const pool = new Pool({ connectionString: process.env.T10_DATABASE_URL })
  const bytes = await readFile('test/fixtures/tone-then-silence.ogg')
  const objects = new Map<string, Uint8Array>()
  const uploads: string[] = []
  const removals: { key: string; catalogEntryExists: boolean }[] = []
  const invocation: Invocation = {
    messageId: randomUUID(),
    guildId: randomUUID(),
    channelId: 'channel',
    requester: { id: '100000000000000001', username: 'ana' },
    content: '',
    createdAt: Date.now(),
    attachments: [],
  }
  try {
    await migrateMemoryDatabase(pool)
    const catalog = composeCapabilities({
      audio: audioCatalog(
        {
          pool,
          embedding: options.embedding,
          ownerId: owner.id,
          async read(key) {
            const body = objects.get(key)
            assert.ok(body)
            return Buffer.from(body)
          },
          store: {
            async put(key, body) {
              uploads.push(key)
              objects.set(key, body)
            },
            async remove(key) {
              const { rowCount } = await pool.query(
                'SELECT 1 FROM channel_audio WHERE object_key = $1',
                [key],
              )
              removals.push({ key, catalogEntryExists: rowCount !== 0 })
              if (options.failRemoval) throw new Error('Fake bucket unavailable')
              objects.delete(key)
            },
          },
        },
        options.reauthorize ?? (async () => true),
      ),
      speech: {
        generator: {
          generate: async (text) => ({
            data: text === spokenText ? bytes : encodeOggOpus(Buffer.alloc(48000), 24000),
            voice,
          }),
        },
        cooldown: options.speechCooldown ?? {
          reserve: async () => ({ granted: true, release: async () => {} }),
        },
      },
      voicePlayback: {
        stage: { isBusy: () => false, play: async () => ({ status: 'played' }) },
        location:
          options.location ??
          (async () => ({
            status: 'found',
            channelId: 'voice',
            channelName: 'General',
          })),
        savedCooldown: options.savedCooldown ?? {
          reserve: async () => ({ granted: true, release: async () => {} }),
        },
      },
    })
    const plans = new Map<string, ModelTurn['calls']>()
    const conversation = createConversation({
      catalog,
      authorize: async () => true,
      claim: async () => true,
      reply: async () => undefined,
      model: {
        async generate({ invocation, results }) {
          const plan = plans.get(invocation.messageId)!
          if (options.sequential && results.length < plan.length)
            return { text: '', calls: [plan[results.length]] }
          if (!results.length) return { text: '', calls: plan }
          const result = results.at(-1)!
          if (
            result.name === 'voice_play' &&
            typeof result.value === 'object' &&
            result.value &&
            'status' in result.value &&
            (result.value.status === 'not_found' || result.value.status === 'rate_limited')
          )
            return { calls: [], text: '' }
          return { calls: [], text: JSON.stringify(result.value ?? result.status) }
        },
      },
    })
    async function ask(
      content: string,
      calls: ModelTurn['calls'],
      overrides?: Partial<Invocation>,
    ) {
      const replies: Reply[] = []
      const request = { ...invocation, messageId: randomUUID(), content, ...overrides }
      plans.set(request.messageId, calls)
      try {
        await conversation.handle(request, async (_, reply) => {
          replies.push(reply)
        })
        return replies
      } finally {
        plans.delete(request.messageId)
      }
    }
    await run({ pool, objects, bytes, ask, invocation, uploads, removals })
  } finally {
    try {
      await pool.query('DELETE FROM channel_audio WHERE guild_id = $1', [invocation.guildId])
    } finally {
      await pool.end()
    }
  }
}

function modelAnswer(replies: Reply[]) {
  const text = replies.map(({ content }) => content).find(Boolean)
  assert.ok(text)
  return JSON.parse(text)
}

test(
  'an invocation can deliver and save its generated speech with the exact transcript',
  dbTest,
  () =>
    withCatalog(async ({ pool, objects, bytes, ask, invocation }) => {
      const replies = await ask('Di que la misión terminó y guarda el audio.', generateAndSave(), {
        messageId: invocation.messageId,
      })
      const saved = modelAnswer(replies)
      assert.equal(saved.outcome, 'saved')
      assert.deepEqual(
        replies.flatMap(({ files }) => files ?? []).map(({ voice }) => voice),
        [voice],
      )
      const { rows } = await pool.query('SELECT * FROM channel_audio WHERE id = $1', [saved.id])
      const key = `${invocation.guildId}/${invocation.channelId}/${saved.id}.ogg`
      assert.equal(rows[0].origin, 'generated')
      assert.equal(rows[0].author_id, invocation.requester.id)
      assert.equal(rows[0].source_message_id, invocation.messageId)
      assert.equal(rows[0].title, saveInput.title)
      assert.equal(rows[0].description, saveInput.description)
      assert.equal(rows[0].transcript, spokenText)
      assert.deepEqual(rows[0].tags, ['victoria'])
      assert.equal(rows[0].duration_ms, 1000)
      assert.equal(rows[0].waveform, voice.waveform)
      assert.equal(rows[0].size_bytes, bytes.length)
      assert.equal(rows[0].sha256, createHash('sha256').update(bytes).digest('hex'))
      assert.equal(rows[0].object_key, key)
      assert.deepEqual(objects.get(key), bytes)
    }),
)

test(
  'search finds saved speech by its transcript and shows metadata only in its own channel',
  dbTest,
  () =>
    withCatalog(async ({ ask }) => {
      const saved = modelAnswer(await ask('Di esto y guárdalo.', generateAndSave()))
      const search = [call('audio_search', { query: 'mision' })]
      const found = modelAnswer(await ask('¿Tienes algún audio de la misión?', search))
      assert.equal(found.outcome, 'found')
      assert.deepEqual(found.records, [
        {
          id: saved.id,
          title: saveInput.title,
          description: saveInput.description,
          durationMs: 1000,
        },
      ])
      const isolated = modelAnswer(
        await ask('¿Tienes algún audio de la misión?', search, { channelId: 'thread' }),
      )
      assert.deepEqual(isolated, { outcome: 'none', records: [], limited: false })
    }),
)

test('sharing by description sends the best match as a standalone voice message', dbTest, () =>
  withCatalog(async ({ ask, bytes }) => {
    const saved = modelAnswer(await ask('Di esto y guárdalo.', generateAndSave()))
    const other = { ...saveInput, title: 'La partida', description: 'Un grito al fondo.' }
    await ask('Di otra cosa y guárdala.', generateAndSave(other, 'Eso fue todo.'))
    const share = [call('audio_share', { selector: 'el audio del grito' })]
    const replies = await ask('Manda el audio del grito por el chat.', share)
    const delivered = replies.filter(({ files }) => files?.length)
    assert.equal(delivered.length, 1)
    assert.equal(delivered[0].content, '')
    assert.deepEqual(
      delivered[0].files?.map(({ attachment, voice }) => ({ attachment, voice })),
      [{ attachment: bytes, voice }],
    )
    const byId = [call('audio_share', { selector: saved.id })]
    assert.equal(
      modelAnswer(await ask('Manda el audio.', byId, { channelId: 'thread' })).outcome,
      'not_found',
    )
  }),
)

test(
  'saving identical bytes in the same channel uploads once, even during concurrent invocations',
  dbTest,
  () =>
    withCatalog(async ({ ask, uploads, objects }) => {
      const outcomes = (
        await Promise.all([
          ask('Di esto y guárdalo.', generateAndSave()),
          ask('Di lo mismo y guárdalo.', generateAndSave({ ...saveInput, title: 'Otro título' })),
        ])
      ).map(modelAnswer)
      const saved = outcomes.find(({ outcome }) => outcome === 'saved')
      assert.ok(saved)
      assert.deepEqual(
        outcomes.find(({ outcome }) => outcome === 'already_saved'),
        { ...saved, outcome: 'already_saved' },
      )
      assert.equal(uploads.length, 1)
      assert.equal(objects.size, 1)
      const inThread = modelAnswer(
        await ask('Di esto y guárdalo aquí.', generateAndSave(), { channelId: 'thread' }),
      )
      assert.equal(inThread.outcome, 'saved')
      assert.notEqual(inThread.id, saved.id)
      assert.equal(uploads.length, 2)
    }),
)

test('search uses matching embeddings when the catalog has an embedding model', dbTest, () =>
  withCatalog(
    async ({ ask }) => {
      const saved = modelAnswer(await ask('Di esto y guárdalo.', generateAndSave()))
      const unrelated = { ...saveInput, title: 'Otra partida', description: 'Resumen distinto.' }
      await ask('Di otra cosa y guárdala.', generateAndSave(unrelated, 'Eso fue todo.'))
      const search = await ask('¿Tienes algún audio de un alarido?', [
        call('audio_search', { query: 'alarido' }),
      ])
      assert.deepEqual(
        modelAnswer(search).records.map(({ id }: { id: string }) => id),
        [saved.id],
      )
    },
    {
      embedding: {
        model: 'fixture-embedding',
        async embed(text) {
          return text === 'alarido' || text.startsWith(saveInput.title) ? [1, 0] : [0, 1]
        },
      },
    },
  ),
)

test('a later invocation cannot save a previous invocation’s generated speech', dbTest, () =>
  withCatalog(async ({ ask, uploads }) => {
    await ask('Di que la misión terminó.', [call('speech_generate', { text: spokenText })])
    const result = modelAnswer(
      await ask('Guarda el audio de antes.', [call('audio_save', saveInput)]),
    )
    assert.equal(result.outcome, 'invalid')
    assert.deepEqual(uploads, [])
  }),
)

test('a failed insert removes the uploaded audio', dbTest, () =>
  withCatalog(async ({ ask, uploads, objects }) => {
    // PostgreSQL text rejects NUL, which here reaches the insert as the source message ID.
    const failed = await ask('Di esto y guárdalo.', generateAndSave(), { messageId: 'invalid\0id' })
    assert.equal(modelAnswer(failed), 'uncertain')
    assert.equal(uploads.length, 1)
    assert.equal(objects.size, 0)
    const search = await ask('¿Hay audios guardados?', [call('audio_search', { query: '' })])
    assert.equal(modelAnswer(search).outcome, 'none')
  }),
)

test('playing an audio by ID schedules it from the invocation channel only', dbTest, () =>
  withCatalog(async ({ ask, invocation, bytes }) => {
    const saved = modelAnswer(await ask('Di esto y guárdalo.', generateAndSave()))
    const play = [call('voice_play', { audio: { id: saved.id } })]
    const replies = await ask('Pon este audio en voz.', play)
    const playback = replies.find(({ voicePlayback }) => voicePlayback)?.voicePlayback
    assert.ok(playback)
    assert.deepEqual(playback, {
      guildId: invocation.guildId,
      channelId: 'voice',
      file: { name: `gnomo-${saved.id}.ogg`, attachment: bytes, voice },
    })
    assert.ok(replies.every(({ files }) => !files?.length))

    const missing = await ask('Pon este audio en voz.', play, { channelId: 'thread' })
    assert.equal(missing[0]?.content, 'No encontré ese audio guardado en este canal.')
    assert.ok(missing.every(({ voicePlayback, files }) => !voicePlayback && !files?.length))
  }),
)

test(
  'playing by description delivers the best match in chat when the requester is outside voice',
  dbTest,
  () =>
    withCatalog(
      async ({ ask, bytes }) => {
        const saved = modelAnswer(await ask('Di esto y guárdalo.', generateAndSave()))
        const other = { ...saveInput, title: 'La partida', description: 'Un grito al fondo.' }
        await ask('Di otra cosa y guárdala.', generateAndSave(other, 'Eso fue todo.'))
        const replies = await ask('Pon el audio del grito.', [
          call('voice_play', { audio: { query: 'el audio del grito' } }),
        ])
        assert.deepEqual(modelAnswer(replies), { status: 'fallback', delivered: 'chat' })
        assert.ok(replies.every(({ voicePlayback }) => !voicePlayback))
        const messages = replies.filter(({ files }) => files?.length)
        assert.equal(messages.length, 1)
        assert.equal(messages[0].content, '')
        assert.deepEqual(messages[0].files, [
          { name: `gnomo-${saved.id}.ogg`, attachment: bytes, voice },
        ])
      },
      {
        location: async () => ({ status: 'absent' }),
        savedCooldown: { reserve: async () => ({ granted: false, retryInMs: 5000 }) },
      },
    ),
)

test('repeat playback in the same server reports the wait to that requester', dbTest, () => {
  const slots = new Set<string>()
  return withCatalog(
    async ({ ask }) => {
      await ask('Di esto y guárdalo.', generateAndSave())
      await ask('Di esto y guárdalo aquí.', generateAndSave(), { channelId: 'thread' })
      const play = [call('voice_play', { audio: { query: 'el grito' } })]
      const first = await ask('Pon el audio del grito.', play)
      assert.ok(first.some(({ voicePlayback }) => voicePlayback))
      const repeated = await ask('Pon el audio del grito otra vez.', play, { channelId: 'thread' })
      assert.ok(repeated.every(({ voicePlayback, files }) => !voicePlayback && !files?.length))
      assert.equal(repeated[0]?.content, 'Espera 23 segundos para reproducir otro audio guardado.')

      const other = await ask('Pon el audio del grito.', play, {
        requester: { id: '100000000000000004', username: 'pedro' },
      })
      assert.ok(other.some(({ voicePlayback }) => voicePlayback))
    },
    {
      savedCooldown: {
        async reserve({ guildId, requester }) {
          const key = `${guildId}:${requester.id}`
          if (slots.has(key)) return { granted: false, retryInMs: 22_500 }
          slots.add(key)
          return {
            granted: true,
            release: async () => {
              slots.delete(key)
            },
          }
        },
      },
    },
  )
})

test('one speech allowance covers generating, playing and saving the same audio', dbTest, () => {
  let speechReservations = 0
  return withCatalog(
    async ({ ask, invocation, objects, bytes }) => {
      const [generate, save] = generateAndSave()
      const replies = await ask('Únete y di que la misión terminó, y guarda el audio.', [
        generate,
        call('voice_play', { audio: 'generated' }),
        save,
      ])
      const saved = modelAnswer(replies)
      assert.equal(saved.outcome, 'saved')
      assert.equal(speechReservations, 1)
      const playback = replies.find(({ voicePlayback }) => voicePlayback)?.voicePlayback
      assert.equal(playback?.channelId, 'voice')
      assert.deepEqual(playback?.file.attachment, bytes)
      assert.ok(replies.every(({ files }) => !files?.length))
      assert.deepEqual(
        objects.get(`${invocation.guildId}/${invocation.channelId}/${saved.id}.ogg`),
        bytes,
      )
    },
    {
      sequential: true,
      speechCooldown: {
        async reserve() {
          speechReservations++
          return { granted: true, release: async () => {} }
        },
      },
      savedCooldown: { reserve: async () => ({ granted: false, retryInMs: 5000 }) },
    },
  )
})

test('the author can forget an audio, removing it from the catalog and the bucket', dbTest, () =>
  withCatalog(async ({ ask, objects, removals }) => {
    const saved = modelAnswer(await ask('Di esto y guárdalo.', generateAndSave()))
    assert.equal(saved.outcome, 'saved')
    assert.equal(objects.size, 1)
    const [key] = objects.keys()
    const forgotten = await ask(`Olvida el audio ${saved.id}.`, [
      call('audio_forget', { id: saved.id }),
    ])
    assert.equal(forgotten[0]?.content, 'Olvidé el audio de este canal.')
    assert.deepEqual(removals, [{ key, catalogEntryExists: false }])
    assert.equal(objects.size, 0)

    const search = await ask('¿Qué audios tienes?', [call('audio_search', { query: '' })])
    assert.deepEqual(modelAnswer(search), { outcome: 'none', records: [], limited: false })
    const share = await ask(`Manda el audio ${saved.id}.`, [
      call('audio_share', { selector: saved.id }),
    ])
    assert.deepEqual(modelAnswer(share), { outcome: 'not_found' })
    assert.ok(share.every(({ files }) => !files?.length))

    const playback = await ask(`Reproduce el audio ${saved.id} en voz.`, [
      call('voice_play', { audio: { id: saved.id } }),
    ])
    assert.equal(playback[0]?.content, 'No encontré ese audio guardado en este canal.')
    assert.ok(playback.every(({ voicePlayback, files }) => !voicePlayback && !files?.length))
  }),
)

test('the bot owner can forget audio saved by another member', dbTest, () =>
  withCatalog(async ({ ask, objects }) => {
    const saved = modelAnswer(await ask('Di esto y guárdalo.', generateAndSave()))
    assert.equal(saved.outcome, 'saved')
    const forgotten = await ask(
      `Olvida el audio ${saved.id}.`,
      [call('audio_forget', { id: saved.id })],
      { requester: owner },
    )
    assert.equal(forgotten[0]?.content, 'Olvidé el audio de este canal.')
    assert.equal(objects.size, 0)
  }),
)

test('another member cannot forget audio they did not save', dbTest, () =>
  withCatalog(async ({ ask, objects, removals }) => {
    const saved = modelAnswer(await ask('Di esto y guárdalo.', generateAndSave()))
    assert.equal(saved.outcome, 'saved')
    const member = { id: '100000000000000003', username: 'juan' }
    const refused = await ask(
      `Olvida el audio ${saved.id}.`,
      [call('audio_forget', { id: saved.id })],
      { requester: member },
    )
    assert.equal(
      refused[0]?.content,
      'Solo quien guardó el audio o el propietario del bot puede borrarlo.',
    )
    assert.deepEqual(removals, [])
    assert.equal(objects.size, 1)
    const search = await ask('¿Qué audios tienes?', [call('audio_search', { query: '' })])
    assert.equal(modelAnswer(search).records[0]?.id, saved.id)
  }),
)

test('even the bot owner cannot forget an audio ID from another channel', dbTest, () =>
  withCatalog(async ({ ask, objects, removals }) => {
    const saved = modelAnswer(await ask('Di esto y guárdalo.', generateAndSave()))
    assert.equal(saved.outcome, 'saved')
    const missing = await ask(
      `Olvida el audio ${saved.id}.`,
      [call('audio_forget', { id: saved.id })],
      { requester: owner, channelId: 'thread' },
    )
    assert.equal(missing[0]?.content, 'No encontré ese audio en este canal.')
    assert.deepEqual(removals, [])
    assert.equal(objects.size, 1)
    const search = await ask('¿Qué audios tienes?', [call('audio_search', { query: '' })])
    assert.equal(modelAnswer(search).records[0]?.id, saved.id)
  }),
)

test('forget refuses the author if the permission recheck fails', dbTest, () => {
  let allowed = true
  return withCatalog(
    async ({ ask, objects, removals }) => {
      const saved = modelAnswer(await ask('Di esto y guárdalo.', generateAndSave()))
      assert.equal(saved.outcome, 'saved')
      allowed = false
      const refused = await ask(`Olvida el audio ${saved.id}.`, [
        call('audio_forget', { id: saved.id }),
      ])
      assert.equal(refused[0]?.content, 'Permisos actuales insuficientes.')
      assert.deepEqual(removals, [])
      assert.equal(objects.size, 1)
      const search = await ask('¿Qué audios tienes?', [call('audio_search', { query: '' })])
      assert.equal(modelAnswer(search).records[0]?.id, saved.id)
    },
    { reauthorize: async () => allowed },
  )
})

test('forget reports a bucket failure without restoring the catalog entry', dbTest, () =>
  withCatalog(
    async ({ ask, objects }) => {
      const saved = modelAnswer(await ask('Di esto y guárdalo.', generateAndSave()))
      assert.equal(saved.outcome, 'saved')
      const forgotten = await ask(`Olvida el audio ${saved.id}.`, [
        call('audio_forget', { id: saved.id }),
      ])
      assert.equal(
        forgotten[0]?.content,
        'Quité el audio del catálogo, pero no pude borrar el archivo del bucket.',
      )
      const search = await ask('¿Qué audios tienes?', [call('audio_search', { query: '' })])
      assert.equal(modelAnswer(search).outcome, 'none')
      assert.equal(objects.size, 1)
    },
    { failRemoval: true },
  ),
)
