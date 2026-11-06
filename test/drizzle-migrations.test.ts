import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { migrateMemoryDatabase } from '../src/database/migrate'
import { createSandbox } from '../src/sandbox/sandbox'

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
      let sandbox = createSandbox({ session: 'drizzle-test', memory: { pool } })
      assert.match(
        (await sandbox.ask('guarda recuerdo [clave=fresh]: Portal')).replies[0].content,
        /saved/,
      )
      assert.match((await sandbox.ask('busca recuerdos: Portal')).replies[0].content, /Portal/)
      await reset()
      await pool.query(await readFile('test/fixtures/database/pre-drizzle.sql', 'utf8'))
      sandbox = createSandbox({ session: 'drizzle-test', memory: { pool } })
      const original = JSON.parse(
        (await sandbox.ask('guarda recuerdo [clave=existing]: Portal existente')).replies[0]
          .content,
      )
      await Promise.all([migrateMemoryDatabase(pool), migrateMemoryDatabase(pool)])
      const recalled = JSON.parse(
        (
          await createSandbox({ session: 'drizzle-test', memory: { pool } }).ask(
            'busca recuerdos: Portal',
          )
        ).replies[0].content,
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
