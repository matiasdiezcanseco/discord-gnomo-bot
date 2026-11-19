import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Pool } from 'pg'
import { audioCapabilities } from '../src/conversation/audio-catalog'
import { ffmpegAudioConverter } from '../src/conversation/audio-upload-converter'
import { composeCapabilities } from '../src/conversation/capabilities'
import type { MemoryEmbedding } from '../src/conversation/explicit-memory'
import { createConversation, type ModelTurn, type Reply } from '../src/conversation/harness'
import { encodeOggOpus } from '../src/conversation/ogg-opus'
import type { Invocation } from '../src/core/conversation/invocation'
import { migrateMemoryDatabase } from '../src/database/migrate'
import { normalizeInvocation } from '../src/modules/discord/normalize-invocation'

const dbTest = { skip: !process.env.T10_DATABASE_URL }
const uploadTest = {
  skip: !process.env.T10_DATABASE_URL
    ? 'T10_DATABASE_URL is not set'
    : (spawnSync('ffmpeg', ['-version']).error as (Error & { code?: string }) | undefined)?.code ===
        'ENOENT' && 'ffmpeg is not installed',
}
const call = (name: string, input: unknown) => ({ id: randomUUID(), name, input })
const saveInput = {
  source: 'generated',
  title: 'El grito del lunes',
  description: 'Gnomo celebra el fin de la partida.',
  tags: ['Victoria'],
}
const spokenText = 'La misión terminó, causa.'
const voice = { durationSecs: 1, waveform: '/wCA' }
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
  }) => Promise<void>,
  embedding?: MemoryEmbedding,
  upload?: NonNullable<Parameters<typeof audioCapabilities>[0]>['upload'],
) {
  const pool = new Pool({ connectionString: process.env.T10_DATABASE_URL })
  const bytes = await readFile('test/fixtures/tone-then-silence.ogg')
  const objects = new Map<string, Uint8Array>()
  const uploads: string[] = []
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
      audio: audioCapabilities(
        {
          pool,
          embedding,
          upload,
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
              objects.delete(key)
            },
          },
        },
        async () => true,
      ),
      speech: {
        generator: {
          generate: async (text) => ({
            data: text === spokenText ? bytes : encodeOggOpus(Buffer.alloc(48000), 24000),
            voice,
          }),
        },
        cooldown: { reserve: async () => ({ granted: true, release: async () => {} }) },
      },
      voicePlayback: {
        stage: { isBusy: () => false, play: async () => ({ status: 'played' }) },
        location: async () => ({ status: 'found', channelId: 'voice', channelName: 'General' }),
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
          if (!results.length) return { text: '', calls: plans.get(invocation.messageId)! }
          const result = results.at(-1)!
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
    await run({ pool, objects, bytes, ask, invocation, uploads })
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

const attachmentInput = { ...saveInput, source: 'attachment', description: 'El grito de Pedro.' }
const audioAttachment = (size: number) => ({
  id: randomUUID(),
  name: 'grito.wav',
  url: 'https://cdn.discordapp.com/attachments/123/456/grito.wav',
  contentType: 'audio/wav',
  size,
})

function replyingTo(
  invocation: Invocation,
  attachment: Invocation['attachments'][number],
  channelId = invocation.channelId,
) {
  return normalizeInvocation(
    {
      id: invocation.messageId,
      guildId: invocation.guildId,
      channelId: invocation.channelId,
      createdTimestamp: invocation.createdAt,
      content: '<@99> Guarda el audio de la victoria.',
      author: { ...invocation.requester, bot: false },
      attachments: new Map(),
      reference: { messageId: 'original-message', channelId },
    },
    invocation.guildId,
    '99',
    [attachment],
  )!
}

function uploadFor(bytes: Buffer, convert = ffmpegAudioConverter()) {
  return {
    maxBytes: 8 * 1024 * 1024,
    maxSeconds: 60,
    convert,
    async read(url: string) {
      return {
        status: 'complete' as const,
        bytes,
        contentType: 'application/octet-stream',
        url,
        requestedUrl: url,
        retrievedAt: new Date().toISOString(),
      }
    },
  }
}

test(
  'a WAV attached to the request is saved and can be shared as a voice message',
  uploadTest,
  async () => {
    const bytes = await readFile('test/fixtures/audio/tone.wav')
    const attachment = audioAttachment(bytes.length)
    await withCatalog(
      async ({ ask }) => {
        const saved = modelAnswer(
          await ask(
            'Guarda este audio como el grito de Pedro.',
            [call('audio_save', attachmentInput)],
            { attachments: [attachment] },
          ),
        )
        assert.equal(saved.outcome, 'saved')
        const replies = await ask('Mándame el grito de Pedro por chat.', [
          call('audio_share', { selector: saved.id }),
        ])
        const [file] = replies.flatMap(({ files }) => files ?? [])
        assert.match(file.name, /\.ogg$/)
        assert.match(file.attachment.toString('ascii', 0, 4), /^OggS$/)
        assert.equal(file.voice?.durationSecs, 1)
        assert.equal(Buffer.from(file.voice!.waveform, 'base64').length, 10)
      },
      undefined,
      uploadFor(bytes),
    )
  },
)

test(
  'a reply can save the original member attachment and records its provenance',
  uploadTest,
  async () => {
    const bytes = await readFile('test/fixtures/audio/tone.mp3')
    const attachment = {
      ...audioAttachment(bytes.length),
      name: 'grito.mp3',
      contentType: 'audio/mpeg',
    }
    await withCatalog(
      async ({ ask, invocation, pool }) => {
        const reply = replyingTo(invocation, attachment)
        const saved = modelAnswer(
          await ask(reply.content, [call('audio_save', attachmentInput)], reply),
        )
        assert.equal(saved.outcome, 'saved')
        const { rows } = await pool.query(
          'SELECT source_message_id, source_attachment_id, origin, transcript FROM channel_audio WHERE id = $1',
          [saved.id],
        )
        assert.deepEqual(rows, [
          {
            source_message_id: 'original-message',
            source_attachment_id: attachment.id,
            origin: 'uploaded',
            transcript: null,
          },
        ])
      },
      undefined,
      uploadFor(bytes),
    )
  },
)

test(
  'a reply can save a Gnomo voice message once and share its decoded duration',
  uploadTest,
  async () => {
    const bytes = await readFile('test/fixtures/tone-then-silence.ogg')
    await withCatalog(
      async ({ ask, invocation, uploads }) => {
        const delivered = await ask('Di que ganamos en una nota de voz.', [
          call('speech_generate', { text: spokenText }),
        ])
        const [voiceMessage] = delivered.flatMap(({ files }) => files ?? [])
        assert.ok(voiceMessage.voice)
        const attachment = {
          ...audioAttachment(voiceMessage.attachment.length),
          name: voiceMessage.name,
          contentType: 'audio/ogg',
        }
        const reply = replyingTo(invocation, attachment)
        const save = [call('audio_save', attachmentInput)]
        const saved = modelAnswer(
          await ask(reply.content, save, { ...reply, messageId: randomUUID() }),
        )
        assert.equal(saved.outcome, 'saved')
        const duplicate = modelAnswer(
          await ask(reply.content, save, { ...reply, messageId: randomUUID() }),
        )
        assert.deepEqual(duplicate, { ...saved, outcome: 'already_saved' })
        assert.equal(uploads.length, 1)
        const shared = await ask('Mándame el audio original.', [
          call('audio_share', { selector: saved.id }),
        ])
        assert.equal(shared.flatMap(({ files }) => files ?? [])[0].voice?.durationSecs, 3)
      },
      undefined,
      uploadFor(bytes),
    )
  },
)

test(
  'attachment saves refuse missing descriptions, oversized, overlong, and damaged audio, and cross-channel replies',
  uploadTest,
  async () => {
    const wav = await readFile('test/fixtures/audio/tone.wav')
    const damaged = await readFile('test/fixtures/audio/not-audio.txt')
    const tooLong = await readFile('test/fixtures/audio/over-60s.ogg')
    const valid = audioAttachment(wav.length)
    const oversized = { ...valid, size: 8 * 1024 * 1024 + 1 }
    const tooLongAttachment = {
      ...valid,
      url: 'long',
      contentType: 'audio/ogg',
      size: tooLong.length,
    }
    const damagedAttachment = { ...valid, url: 'damaged', size: damaged.length }
    const servedOversized = { ...valid, url: 'servedOversized' }
    const upload = uploadFor(wav)
    const bodies = new Map([
      ['long', tooLong],
      ['damaged', damaged],
      ['servedOversized', Buffer.alloc(oversized.size)],
    ])
    await withCatalog(
      async ({ ask, invocation, uploads }) => {
        const refusals: [Partial<Invocation>, string | undefined, RegExp][] = [
          [{ attachments: [valid] }, undefined, /de qué trata/],
          [{ attachments: [oversized] }, attachmentInput.description, /8 MiB/],
          [{ attachments: [servedOversized] }, attachmentInput.description, /8 MiB/],
          [{ attachments: [tooLongAttachment] }, attachmentInput.description, /60 segundos/],
          [
            { attachments: [damagedAttachment] },
            attachmentInput.description,
            /audio compatible o está dañado/,
          ],
          [
            replyingTo(invocation, valid, 'another-channel'),
            attachmentInput.description,
            /Adjunta un archivo de audio/,
          ],
        ]
        for (const [overrides, description, message] of refusals) {
          const result = modelAnswer(
            await ask(
              description ? 'Guarda este audio como el grito de Pedro.' : 'Guarda este audio.',
              [call('audio_save', { ...attachmentInput, description })],
              { ...overrides, messageId: randomUUID() },
            ),
          )
          assert.equal(result.outcome, 'invalid')
          assert.match(result.message, message)
        }
        assert.deepEqual(uploads, [])
      },
      undefined,
      {
        ...upload,
        async read(url) {
          const bytes = bodies.get(url)
          assert.ok(bytes)
          return { ...(await upload.read(url)), bytes }
        },
      },
    )
  },
)

test(
  'missing ffmpeg makes attachment saves unavailable while generated saves still work',
  dbTest,
  async () => {
    const bytes = await readFile('test/fixtures/audio/tone.wav')
    await withCatalog(
      async ({ ask, uploads }) => {
        const result = modelAnswer(
          await ask(
            'Guarda este audio como el grito de Pedro.',
            [call('audio_save', attachmentInput)],
            { attachments: [audioAttachment(bytes.length)] },
          ),
        )
        assert.equal(result.outcome, 'unavailable')
        assert.deepEqual(uploads, [])
        const saved = modelAnswer(await ask('Di que ganamos y guarda el audio.', generateAndSave()))
        assert.equal(saved.outcome, 'saved')
        assert.equal(uploads.length, 1)
      },
      undefined,
      uploadFor(bytes, ffmpegAudioConverter('gnomo-test-missing-ffmpeg')),
    )
  },
)

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
      model: 'fixture-embedding',
      async embed(text) {
        return text === 'alarido' || text.startsWith(saveInput.title) ? [1, 0] : [0, 1]
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

test('the same generated speech can be scheduled for voice playback and saved', dbTest, () =>
  withCatalog(async ({ ask, invocation, objects, bytes }) => {
    const [generate, save] = generateAndSave()
    const replies = await ask('Únete y di que la misión terminó, y guarda el audio.', [
      generate,
      call('voice_play', { audio: 'generated' }),
      save,
    ])
    const saved = modelAnswer(replies)
    assert.equal(saved.outcome, 'saved')
    const playback = replies.find(({ voicePlayback }) => voicePlayback)?.voicePlayback
    assert.equal(playback?.channelId, 'voice')
    assert.deepEqual(playback?.file.attachment, bytes)
    assert.ok(replies.every(({ files }) => !files?.length))
    assert.deepEqual(
      objects.get(`${invocation.guildId}/${invocation.channelId}/${saved.id}.ogg`),
      bytes,
    )
  }),
)
