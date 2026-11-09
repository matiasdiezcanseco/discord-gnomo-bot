import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { migrateMemoryDatabase } from '../src/database/migrate'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createConversation, type Reply } from '../src/conversation/harness'
import { composeCapabilities } from '../src/conversation/capabilities'
import { memoryCapabilities } from '../src/conversation/explicit-memory'
import { commandModel } from './command-model'

/** Explicit-memory conversation over the given pool; each call is a fresh receiver instance. */
function memoryApp(pool: Pool) {
  const app = createConversation({
    model: commandModel(),
    catalog: composeCapabilities({
      memory: memoryCapabilities({ pool }, '100000000000000004', async () => true),
    }),
    authorize: async () => true,
    claim: async () => true,
    reply: async () => undefined,
  })
  return {
    async ask(content: string) {
      const replies: Reply[] = []
      await app.handle(
        {
          guildId: '100000000000000001',
          channelId: '100000000000000002',
          messageId: randomUUID(),
          requester: { id: '100000000000000004', username: 'tester' },
          content,
          createdAt: Date.now(),
          attachments: [],
        },
        async (_, reply) => {
          replies.push(reply)
        },
      )
      return { replies }
    },
  }
}

test(
  'Drizzle installs fresh storage and adopts existing memories once under concurrent migration',
  {
    skip: !process.env.DRIZZLE_TEST_DATABASE_URL,
  },
  async () => {
    const url = process.env.DRIZZLE_TEST_DATABASE_URL!
    assert.equal(new URL(url).pathname, '/gnomo_drizzle')
    assert.equal(new URL(url).hostname, '127.0.0.1')
    const pool = new Pool({ connectionString: url })
    const reset = () =>
      pool.query(
        'DROP TABLE IF EXISTS pilot_memory_operations; DROP TABLE IF EXISTS pilot_memories CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE',
      )
    try {
      await reset()
      await migrateMemoryDatabase(pool)
      assert.match(
        execFileSync(
          process.execPath,
          [
            'node_modules/tsx/dist/cli.mjs',
            '--tsconfig',
            'tsconfig.nest.json',
            'src/database/migrate.ts',
          ],
          {
            env: {
              ...process.env,
              DATABASE_URL: url,
              DATABASE_URL_POOLED: 'postgresql://fixture:fixture@127.0.0.1:1/unreachable',
              PILOT_MEMORY_DATABASE_URL: undefined,
            },
            encoding: 'utf8',
          },
        ),
        /Drizzle memory migrations applied/,
      )
      let sandbox = memoryApp(pool)
      assert.match(
        (await sandbox.ask('guarda recuerdo [clave=fresh]: Portal')).replies[0].content,
        /saved/,
      )
      assert.match((await sandbox.ask('busca recuerdos: Portal')).replies[0].content, /Portal/)
      await reset()
      await pool.query(await readFile('test/fixtures/database/pre-drizzle.sql', 'utf8'))
      sandbox = memoryApp(pool)
      const original = JSON.parse(
        (await sandbox.ask('guarda recuerdo [clave=existing]: Portal existente')).replies[0]
          .content,
      )
      await Promise.all([migrateMemoryDatabase(pool), migrateMemoryDatabase(pool)])
      const recalled = JSON.parse(
        (await memoryApp(pool).ask('busca recuerdos: Portal')).replies[0].content,
      )
      assert.equal(recalled.records[0].id, original.id)
      assert.equal(recalled.records[0].content, 'Portal existente')
      assert.equal(
        (await pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations'))
          .rows[0].count,
        1,
      )
      await pool.query(
        'DROP SCHEMA drizzle CASCADE; ALTER TABLE pilot_memories ALTER COLUMN content DROP NOT NULL',
      )
      await assert.rejects(migrateMemoryDatabase(pool), /Existing memory schema is incompatible/)
      assert.equal(
        (await pool.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name")).rows[0]
          .name,
        null,
      )
      assert.equal(
        (await pool.query('SELECT content FROM pilot_memories WHERE id=$1', [original.id])).rows[0]
          .content,
        'Portal existente',
      )
    } finally {
      await pool.end()
    }
  },
)
