import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { config } from 'dotenv'
import { memoryDatabase } from './connection'
import { validateBaseline } from './baseline'
import { databasePoolConfig } from './configuration'

/** Explicit operator command only. A session lock serializes journal creation and adoption. */
export async function migrateMemoryDatabase(pool: Pool) {
  const client = await pool.connect()
  const db = memoryDatabase(client)
  try {
    await db.execute(sql`SELECT pg_advisory_lock(hashtextextended('gnomo:drizzle:migrations',0))`)
    await validateBaseline(db)
    await migrate(db, { migrationsFolder: 'drizzle' })
  } finally {
    await db
      .execute(sql`SELECT pg_advisory_unlock(hashtextextended('gnomo:drizzle:migrations',0))`)
      .catch(() => undefined)
    client.release(true)
  }
}

if (require.main === module) {
  config({ path: process.env.DB_ENV_FILE ?? ['.env.local', '.env'], quiet: true })
  let options
  try {
    options = databasePoolConfig(process.env, 'migration')
  } catch {
    console.error(
      'DATABASE_URL must provide a valid direct PostgreSQL connection with verified TLS.',
    )
    process.exitCode = 1
  }
  if (!options) {
    if (!process.exitCode) console.error('DATABASE_URL (or PILOT_MEMORY_DATABASE_URL) is required')
    process.exitCode = 1
  } else {
    const pool = new Pool(options)
    pool.on('error', () => undefined)
    migrateMemoryDatabase(pool)
      .then(() => console.log('Drizzle memory migrations applied. No legacy data imported.'))
      .catch(() => {
        console.error(
          'Database migration failed; inspect schema and migration history before retrying.',
        )
        process.exitCode = 1
      })
      .finally(() => pool.end())
  }
}
