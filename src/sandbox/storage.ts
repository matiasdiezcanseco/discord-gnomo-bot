import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import Redis from 'ioredis'

/** Independent names; never fall back to runtime/production database variables. */
export function sandboxStorage(env: Record<string, string | undefined>) {
  const databaseUrl =
    env.SANDBOX_DATABASE_URL ?? 'postgresql://gnomo:gnomo-local@127.0.0.1:5432/gnomo_sandbox'
  const redisUrl = env.SANDBOX_REDIS_URL ?? 'redis://:gnomo123@127.0.0.1:6379/14'
  try {
    const database = new URL(databaseUrl),
      redis = new URL(redisUrl)
    const local = (url: URL) =>
      ['localhost', '127.0.0.1', '[::1]', 'postgres', 'redis'].includes(url.hostname)
    if (
      !local(database) ||
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      !/^\/gnomo_sandbox(?:_[a-z0-9_]+)?$/.test(database.pathname)
    )
      throw new Error()
    if (!local(redis) || redis.protocol !== 'redis:' || redis.pathname !== '/14') throw new Error()
    return { databaseUrl, redisUrl, database: database.pathname.slice(1) }
  } catch {
    throw new Error('Sandbox requires local gnomo_sandbox database and local Redis database 14')
  }
}

function pool(url: string) {
  const db = new Pool({
    connectionString: url,
    max: 4,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
  })
  db.on('error', () => undefined)
  return db
}

/** Explicit local-only installation; never runs as part of the bot or sandbox startup. */
export async function setupSandboxStorage(env: Record<string, string | undefined>) {
  const config = sandboxStorage(env)
  const adminUrl = new URL(config.databaseUrl)
  adminUrl.pathname = '/postgres'
  const admin = pool(adminUrl.href)
  try {
    if (
      !(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [config.database])).rowCount
    )
      await admin.query(`CREATE DATABASE "${config.database}"`)
  } finally {
    await admin.end()
  }
  const memory = pool(config.databaseUrl)
  try {
    await memory.query(await readFile('prisma/pilot-memory.sql', 'utf8'))
  } finally {
    await memory.end()
  }
}

export async function openSandboxStorage(env: Record<string, string | undefined>) {
  const config = sandboxStorage(env)
  const memory = pool(config.databaseUrl)
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: 0,
    commandTimeout: 3000,
  })
  redis.on('error', () => undefined)
  try {
    const result = await memory.query(
      "SELECT to_regclass('pilot_memories') AS memories, to_regclass('pilot_memory_operations') AS operations",
    )
    if (!result.rows[0].memories || !result.rows[0].operations)
      throw new Error('Missing sandbox schema')
    await redis.connect()
    await redis.ping()
    return {
      memory: { pool: memory },
      redis,
      close: async () => {
        redis.disconnect()
        await memory.end()
      },
    }
  } catch {
    redis.disconnect()
    await memory.end()
    throw new Error(
      'Local sandbox storage unavailable. Start local services and run npm run sandbox:setup.',
    )
  }
}
