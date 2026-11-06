import test from 'node:test'
import assert from 'node:assert/strict'
import { createSandbox } from '../src/sandbox/sandbox'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import Redis from 'ioredis'
import { execFileSync } from 'node:child_process'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import type { ReaderNetwork } from '../src/web/safe-reader'
import { sandboxStorage } from '../src/sandbox/storage'
import sharp from 'sharp'

test('sandbox conversations use local members and channel context without contacting Discord', async () => {
  const sandbox = createSandbox()
  const phrase = await sandbox.ask('dame una frase')
  assert.match(phrase.replies.map((r) => r.content).join(''), /sandbox/i)
  const presence = await sandbox.ask('quién está conectado')
  assert.match(presence.replies.map((r) => r.content).join(''), /Ana/)
  assert.ok(presence.traces.some((t) => t.tool === 'presence_list' && t.status === 'partial'))
  await sandbox.ask('el torneo será el viernes')
  const history = await sandbox.ask('consulta el historial')
  assert.match(history.replies.map((r) => r.content).join(''), /el torneo será el viernes/)
  const other = await sandbox.ask('consulta el historial', { channel: 'juegos' })
  assert.doesNotMatch(other.replies.map((r) => r.content).join(''), /el torneo será el viernes/)
  const news = await sandbox.ask('busca noticias y lee la fuente')
  assert.match(news.replies.map((r) => r.content).join(''), /torneo ficticio/)
  assert.ok(news.traces.some((t) => t.tool === 'web_read' && t.status === 'success'))
})

test('sandbox CLI ignores Discord runtime credentials and accepts piped conversations', () => {
  const output = execFileSync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      '--tsconfig',
      'tsconfig.nest.json',
      'src/sandbox/cli.ts',
      '--memoryless',
      '--json',
    ],
    {
      input: 'dame una frase\nquién está conectado\n',
      encoding: 'utf8',
      env: {
        ...process.env,
        BOT_TOKEN: 'must-not-be-used',
        GUILD_ID: 'real-guild',
        RUNTIME_MODE: 'guild',
      },
    },
  )
  const events = output
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line))
  assert.equal(events.filter((event) => event.type === 'response').length, 2)
  assert.match(output, /Ana/)
  assert.doesNotMatch(output, /must-not-be-used|real-guild/)
})

test('duplicate sandbox invocations neither reply again nor add fabricated history', async () => {
  const sandbox = createSandbox()
  await sandbox.ask('dame una frase', { messageId: 'same-event' })
  const duplicate = await sandbox.ask('FABRICATED DUPLICATE', { messageId: 'same-event' })
  assert.equal(duplicate.replies.length, 0)
  const history = await sandbox.ask('consulta el historial')
  assert.doesNotMatch(history.replies.map((r) => r.content).join(''), /FABRICATED DUPLICATE/)
})

test('sandbox web access blocks Discord destinations including redirects before contacting them', async (t) => {
  const hosts: string[] = []
  const server = createServer((_req, res) => {
    res.writeHead(302, { Location: 'https://discord.com/api/v10/channels/123/messages' })
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing listener')
  const network: ReaderNetwork = {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request(options, listener) {
      hosts.push(String(options.headers && 'Host' in options.headers ? options.headers.Host : ''))
      return request(
        { ...options, protocol: 'http:', hostname: '127.0.0.1', port: address.port },
        listener,
      )
    },
  }
  const sandbox = createSandbox({ liveWeb: true, network })
  for (const url of [
    'https://discord.com/api',
    'https://cdn.discordapp.com/file',
    'https://DISCORD.GG./test',
    'https://[2606:4700:4700::1111]/',
    'http://public.example/article',
  ]) {
    const result = await sandbox.ask(`lee ${url}`)
    assert.match(result.replies.map((r) => r.content).join(''), /blocked/)
  }
  assert.deepEqual(hosts, ['public.example'])
})

test(
  'sandbox memory and reminders survive receiver recreation and deliver only to the local outbox',
  {
    skip: !process.env.SANDBOX_TEST_DATABASE_URL || !process.env.SANDBOX_TEST_REDIS_URL,
  },
  async () => {
    const urls = sandboxStorage({
      SANDBOX_DATABASE_URL: process.env.SANDBOX_TEST_DATABASE_URL,
      SANDBOX_REDIS_URL: process.env.SANDBOX_TEST_REDIS_URL,
    })
    const pool = new Pool({ connectionString: urls.databaseUrl })
    const redis = new Redis(urls.redisUrl)
    const session = `test-${randomUUID().replaceAll('-', '')}`
    const build = () => createSandbox({ session, memory: { pool }, redis })
    try {
      const first = build()
      const save = await first.ask('guarda recuerdo [clave=Portal]: mi juego favorito es Portal')
      assert.match(save.replies.map((r) => r.content).join(''), /saved/)
      await first.ask('recuérdame en 1 minuto jugar Portal')
      const second = build()
      const recalled = await second.ask('busca recuerdos: Portal')
      assert.match(recalled.replies.map((r) => r.content).join(''), /juego favorito es Portal/)
      const foreign = await second.ask('busca recuerdos: Portal', { channel: 'juegos' })
      assert.doesNotMatch(
        foreign.replies.map((r) => r.content).join(''),
        /juego favorito es Portal/,
      )
      const due = await second.advance(61)
      assert.equal(due.length, 1)
      assert.match(due[0].reply.content, /jugar Portal/)
      assert.equal((await build().advance(62)).length, 0)
      const birthdaySandbox = build()
      const birthdays = await birthdaySandbox.birthdays()
      assert.equal(birthdays.length, 1)
      const birthdayDelivery = await birthdaySandbox.advance(
        Math.max(0, (birthdays[0].due - Date.now()) / 1000 + 1),
      )
      assert.match(birthdayDelivery[0].reply.content, /Feliz cumpleaños Ana/)
      const denied = build()
      denied.setPermission(false)
      assert.equal((await denied.ask('dame una frase')).replies.length, 0)
    } finally {
      try {
        await build().ask('olvida recuerdo Portal')
      } finally {
        await pool.end()
        redis.disconnect()
      }
    }
  },
)

test('local image attachments pass the real image verifier before reaching the sandbox model', async () => {
  let seen = 0
  const sandbox = createSandbox({
    model: {
      generate: async ({ images }) => {
        seen++
        assert.equal(images?.[0].source.width, 2)
        return { text: 'Imagen local verificada de 2 píxeles.', calls: [] }
      },
    },
  })
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } })
    .png()
    .toBuffer()
  const result = await sandbox.ask('describe la imagen', {
    images: [{ name: 'blue.png', contentType: 'image/png', bytes }],
  })
  assert.match(result.replies.map((r) => r.content).join(''), /Imagen local verificada/)
  const invalid = await sandbox.ask('describe la imagen', {
    images: [{ name: 'bad.png', contentType: 'image/png', bytes: bytes.subarray(0, 15) }],
  })
  assert.match(invalid.replies.map((r) => r.content).join(''), /No pude usar los adjuntos/)
  assert.equal(seen, 1)
})

test('sandbox CLI refuses runtime/remote databases before attempting a connection', () => {
  for (const overrides of [
    { SANDBOX_DATABASE_URL: 'postgresql://test:test@db.example.com/gnomo_sandbox' },
    { SANDBOX_DATABASE_URL: 'postgresql://gnomo:gnomo-local@127.0.0.1:5432/gnomo' },
    { SANDBOX_REDIS_URL: 'redis://127.0.0.1:6379/15' },
  ]) {
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            'node_modules/tsx/dist/cli.mjs',
            '--tsconfig',
            'tsconfig.nest.json',
            'src/sandbox/cli.ts',
            '--ask',
            'hola',
          ],
          { env: { ...process.env, ...overrides }, encoding: 'utf8', stdio: 'pipe' },
        ),
      /Sandbox requires local/,
    )
  }
})
