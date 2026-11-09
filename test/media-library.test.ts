import 'reflect-metadata'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import sharp from 'sharp'
import { migrateMemoryDatabase } from '../src/database/migrate'
import { createConversation, type ModelInput, type ModelTurn } from '../src/conversation/harness'
import { composeCapabilities } from '../src/conversation/capabilities'
import { capabilityAllowed } from '../src/conversation/execution-policy'
import {
  mediaCapabilities,
  queryTerms,
  rankMedia,
  s3MediaStore,
  type MediaObjectStore,
} from '../src/conversation/media-library'
import type { VerifiedImage } from '../src/conversation/attached-images'
import type { Invocation } from '../src/core/conversation/invocation'
import { normalizeInvocation, referencedImages } from '../src/modules/discord/normalize-invocation'

const owner = '100000000000000009'
const invocation = (content: string, overrides: Partial<Invocation> = {}): Invocation => ({
  messageId: randomUUID(),
  guildId: 'g',
  channelId: 'c',
  requester: { id: '100000000000000001', username: 'ana' },
  content,
  createdAt: Date.now(),
  attachments: [],
  ...overrides,
})
const attachment = (size = 100, contentType: string | null = 'image/png') => ({
  id: randomUUID(),
  url: 'https://cdn.discordapp.com/attachments/x/y/meme.png',
  name: 'meme.png',
  contentType,
  size,
})

/** A real model reads the image and chooses the tool by intent; this one follows fixed scripts. */
function scripted(plan: (input: ModelInput) => ModelTurn['calls']) {
  return {
    generate: async (input: ModelInput): Promise<ModelTurn> => {
      if (input.results.length)
        return {
          text: input.results
            .map((r) =>
              typeof r.value === 'string' ? r.value : JSON.stringify(r.value ?? r.status),
            )
            .join('\n'),
          calls: [],
        }
      return { text: '', calls: plan(input) }
    },
  }
}
const call = (name: string, input: unknown) => ({ id: `${name}-${randomUUID()}`, name, input })

test('search terms ignore accents, stopwords and short words', () => {
  assert.deepEqual(queryTerms('el meme del Gato en la Canción!'), ['gato', 'cancion'])
})

test('ranking prefers title/tag matches, then description, then vectors', () => {
  const rows = [
    { id: '1', title: 'Perro', description: 'un gato al fondo', tags: [], similarity: null },
    { id: '2', title: 'Gato enojado', description: 'cara', tags: ['gato'], similarity: null },
    { id: '3', title: 'Paisaje', description: 'montañas', tags: [], similarity: 0.3 },
    { id: '4', title: 'Felino', description: 'mascota', tags: [], similarity: 0.8 },
  ]
  assert.deepEqual(
    rankMedia(rows, 'gato').map((row) => row.id),
    ['4', '2', '1'],
  )
})

test('object store needs full configuration and builds public Tigris URLs', async () => {
  assert.equal(
    s3MediaStore(() => undefined),
    undefined,
  )
  const env: Record<string, string> = {
    BUCKET_NAME: 'gnomo-media',
    AWS_ENDPOINT_URL_S3: 'https://fly.storage.tigris.dev',
    AWS_ACCESS_KEY_ID: 'key',
    AWS_SECRET_ACCESS_KEY: 'secret',
  }
  const sent: { input: Record<string, unknown> }[] = []
  const store = s3MediaStore((key) => env[key], {
    send: (async (command: { input: Record<string, unknown> }) => {
      sent.push(command)
      return {}
    }) as never,
  })!
  assert.equal(store.publicUrl('g/c/x.png'), 'https://gnomo-media.t3.tigrisfiles.io/g/c/x.png')
  await store.put('g/c/x.png', new Uint8Array([1]), 'image/png', new AbortController().signal)
  assert.equal(sent[0].input.Bucket, 'gnomo-media')
  assert.equal(sent[0].input.ContentType, 'image/png')
  const custom = s3MediaStore(
    (key) => ({ ...env, MEDIA_PUBLIC_URL: 'https://cdn.example/m' })[key],
  )!
  assert.equal(custom.publicUrl('a.png'), 'https://cdn.example/m/a.png')
  assert.throws(() => s3MediaStore((key) => ({ ...env, BUCKET_NAME: 'Bad_Name' })[key]))
})

test('media tools are allowlisted with their declared effects', () => {
  const tools = mediaCapabilities()
  const effects = Object.fromEntries(tools.map((tool) => [tool.name, tool.effect]))
  assert.deepEqual(effects, {
    media_save: 'write',
    media_search: 'read',
    media_share: 'read',
    media_forget: 'write',
  })
  for (const tool of tools) assert.ok(capabilityAllowed(invocation(''), tool))
  assert.ok(!capabilityAllowed(invocation(''), { ...tools[1], effect: 'write' }))
})

test('a tagged reply without attachments uses the replied images that can be verified', () => {
  const kept = attachment()
  const filtered = referencedImages([
    kept,
    attachment(100, 'image/gif'),
    attachment(3_000_000),
    attachment(100, 'video/mp4'),
  ])
  assert.deepEqual(filtered, [kept])
  const event = {
    id: 'm',
    guildId: 'g1',
    channelId: 'c',
    createdTimestamp: 0,
    content: '<@99> guarda este meme',
    author: { id: 'u', username: 'u', bot: false },
    attachments: new Map(),
  }
  assert.deepEqual(normalizeInvocation(event, 'g1', '99', filtered)!.attachments, [kept])
  const own = attachment()
  assert.deepEqual(
    normalizeInvocation({ ...event, attachments: new Map([[own.id, own]]) }, 'g1', '99', filtered)!
      .attachments,
    [own],
  )
})

test('unconfigured media library is explicit and sharing stays hidden', async () => {
  const replies: string[] = []
  let visible: string[] = []
  const app = createConversation({
    catalog: composeCapabilities({}),
    loadImages: async () => [],
    authorize: async () => true,
    claim: async () => true,
    reply: async (_, reply) => {
      replies.push(reply.content)
    },
    model: scripted((input) => {
      visible = input.tools.map((tool) => tool.name)
      return [call('media_save', { title: 'x', description: 'y' })]
    }),
  })
  await app.handle(invocation('guarda este meme', { attachments: [attachment()] }))
  assert.match(replies.join(''), /unavailable: biblioteca de medios deshabilitada/)
  assert.ok(visible.includes('media_save') && !visible.includes('media_share'))
})

test(
  'saved images can be searched, shared as a bare URL and forgotten only by their author',
  { skip: !process.env.T10_DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.T10_DATABASE_URL })
    await migrateMemoryDatabase(pool)
    const guildId = randomUUID()
    const objects = new Map<string, Uint8Array>()
    const store: MediaObjectStore = {
      put: async (key, body) => void objects.set(key, body),
      remove: async (key) => void objects.delete(key),
      publicUrl: (key) => `https://gnomo-media.t3.tigrisfiles.io/${key}`,
    }
    const bytes = await sharp({
      create: { width: 4, height: 3, channels: 3, background: '#f80' },
    })
      .png()
      .toBuffer()
    const image = (messageId: string): VerifiedImage => ({
      bytes,
      mediaType: 'image/png',
      source: {
        attachmentId: 'att',
        messageId,
        requesterId: 'r',
        channelId: 'c',
        width: 4,
        height: 3,
        retrievedAt: new Date().toISOString(),
      },
    })
    let allowed = true
    const replies: string[] = []
    let plan: (input: ModelInput) => ModelTurn['calls'] = () => []
    const loadImages = async ({ invocation }: { invocation: Invocation }) =>
      invocation.attachments.map(() => image(invocation.messageId))
    const app = createConversation({
      loadImages,
      catalog: composeCapabilities({
        media: mediaCapabilities(
          {
            pool,
            store,
            loadImages,
          },
          owner,
          async () => allowed,
        ),
      }),
      authorize: async () => true,
      claim: async () => true,
      reply: async (_, reply) => {
        replies.push(reply.content)
      },
      model: scripted((input) => plan(input)),
    })
    const send = async (content: string, overrides: Partial<Invocation> = {}) => {
      replies.length = 0
      await app.handle(invocation(content, { guildId, ...overrides }))
      return replies.join('\n')
    }
    try {
      plan = () => [
        call('media_save', {
          title: 'Gato enojado',
          description: 'Un gato naranja frunce el ceño. Texto: «LUNES OTRA VEZ».',
          tags: ['Gato', 'lunes', 'gato'],
        }),
      ]
      assert.match(await send('guarda este meme'), /invalid: no hay imagen adjunta/)
      const saved = JSON.parse(await send('guarda este meme', { attachments: [attachment()] }))
      assert.equal(saved.outcome, 'saved')
      assert.deepEqual(saved.tags, ['gato', 'lunes'])
      assert.equal(objects.size, 1)
      const [key] = objects.keys()
      assert.match(key, new RegExp(`^${guildId}/c/${saved.id}\\.png$`))
      const row = (await pool.query('SELECT * FROM channel_media WHERE id=$1', [saved.id])).rows[0]
      assert.equal(row.author_id, '100000000000000001')
      assert.equal(row.width, 4)
      assert.equal(row.size_bytes, bytes.length)
      assert.equal(row.url, `https://gnomo-media.t3.tigrisfiles.io/${key}`)

      // Same bytes, same channel: no second object.
      const again = JSON.parse(await send('guárdalo otra vez', { attachments: [attachment()] }))
      assert.equal(again.outcome, 'already_saved')
      assert.equal(objects.size, 1)

      plan = () => [call('media_search', { query: 'meme de un gato' })]
      const found = JSON.parse(await send('¿qué memes de gatos hay?'))
      assert.equal(found.outcome, 'found')
      assert.equal(found.records[0].id, saved.id)
      assert.equal(found.records[0].savedBy, '<@100000000000000001>')
      assert.ok(!JSON.stringify(found).includes('https://'))

      // Another channel has its own library.
      assert.equal(JSON.parse(await send('¿hay gatos?', { channelId: 'd' })).outcome, 'none')

      plan = () => [call('media_share', { selector: 'el del gato del lunes' })]
      assert.equal(await send('manda el meme del gato'), row.url)
      plan = () => [call('media_share', { selector: 'dinosaurio bailando' })]
      assert.equal(
        await send('manda el dinosaurio'),
        'No encontré ese medio guardado en este canal.',
      )

      // «créala y guárdala»: the image image_generate attached in this request.
      const generated = await sharp({
        create: { width: 6, height: 5, channels: 3, background: '#00f' },
      })
        .jpeg()
        .toBuffer()
      plan = (input) =>
        input.results.length
          ? []
          : [
              call('image_generate', { prompt: 'un gnomo astronauta' }),
              call('media_save', {
                title: 'Gnomo astronauta',
                description: 'Ilustración de un gnomo con traje espacial.',
                source: 'generated',
              }),
            ]
      replies.length = 0
      const files: number[] = []
      const creator = createConversation({
        loadImages,
        catalog: composeCapabilities({
          images: {
            generator: {
              generate: async () => ({
                data: generated,
                mediaType: 'image/jpeg',
                extension: 'jpg',
              }),
            },
            quota: { reserve: async () => ({ granted: true, release: async () => {} }) },
          },
          media: mediaCapabilities({ pool, store, loadImages }, owner, async () => true),
        }),
        authorize: async () => true,
        claim: async () => true,
        reply: async (_, reply) => {
          replies.push(reply.content)
          files.push(reply.files?.length ?? 0)
        },
        model: scripted((input) => plan(input)),
      })
      await creator.handle(invocation('crea un gnomo astronauta y guárdalo', { guildId }))
      const created = JSON.parse(replies.join('\n').split('\n').at(-1)!)
      assert.equal(created.outcome, 'saved')
      assert.ok(files.includes(1), 'the generated image is still attached to the reply')
      const stored = (await pool.query('SELECT * FROM channel_media WHERE id=$1', [created.id]))
        .rows[0]
      assert.equal(stored.media_type, 'image/jpeg')
      assert.equal(stored.width, 6)
      assert.match(stored.source_attachment_id, /^generated:/)
      assert.ok(Buffer.from(objects.get(stored.object_key)!).equals(generated))

      // Without a creation in the same request there is nothing generated to save.
      plan = () => [call('media_save', { title: 'x', description: 'y', source: 'generated' })]
      assert.match(await send('guarda la que hiciste'), /^invalid: no se creó ninguna imagen/)

      plan = () => [call('media_forget', { selector: saved.id })]
      assert.match(
        await send('borra el meme', { requester: { id: '100000000000000002', username: 'b' } }),
        /^denied: solo quien lo guardó/,
      )
      allowed = false
      assert.match(await send('borra el meme'), /^denied: permisos actuales/)
      allowed = true
      assert.equal(JSON.parse(await send('borra el meme')).outcome, 'forgotten')
      assert.ok(!objects.has(key) && objects.has(stored.object_key))
      assert.match(await send('borra el meme'), /^not_found/)
    } finally {
      await pool.query('DELETE FROM channel_media WHERE guild_id=$1', [guildId])
      await pool.end()
    }
  },
)
