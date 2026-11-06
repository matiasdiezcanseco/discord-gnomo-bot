import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import { and, eq, or, sql, DrizzleQueryError } from 'drizzle-orm'
import type { MemoryEmbedding } from '../conversation/explicit-memory'
import { memoryDatabase } from '../database/connection'
import { memories } from '../database/schema'
import { migrationEntries, type LegacyMemory } from './schema'

export type MigrationAction = 'dry-run' | 'backup' | 'import' | 'rollback'
export interface MigrationOptions {
  pool: Pool
  guildId: string
  channelId: string
  destination(): Promise<{ guildId: string | null; channelId: string }>
  approveNullGuild?: boolean
  legacyModel?: string
  model?: string
  dimensions?: number
  embedding?: MemoryEmbedding
  lexicalOnly?: boolean
}

function validVector(values: unknown): values is number[] {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.length <= 4096 &&
    values.every(Number.isFinite) &&
    values.some((v) => v !== 0)
  )
}
function compatibleVector(row: LegacyMemory, options: MigrationOptions): number[] | null {
  try {
    const vector: unknown = row.embedding ? JSON.parse(row.embedding) : null
    return validVector(vector) &&
      options.model &&
      options.legacyModel === options.model &&
      vector.length === options.dimensions
      ? vector
      : null
  } catch {
    return null
  }
}

/** Operator-only lifecycle; never called by startup. Reports/errors contain no content. */
export async function migrateLegacy(options: MigrationOptions, action: MigrationAction) {
  const { pool, guildId, channelId } = options
  if (
    options.dimensions !== undefined &&
    (!Number.isInteger(options.dimensions) || options.dimensions < 1 || options.dimensions > 4096)
  )
    throw new Error('Invalid embedding dimensions')
  if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(channelId))
    throw new Error('Invalid configured destination')
  const validate = async () => {
    const destination = await options.destination()
    if (destination.guildId !== guildId || destination.channelId !== channelId)
      throw new Error('Destination does not belong to configured guild')
  }
  await validate()
  const client = await pool.connect()
  const db = memoryDatabase(client)
  let commitAttempted = false
  try {
    await db.execute(
      sql.raw(action === 'dry-run' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'),
    )
    await db.execute(sql`SET LOCAL statement_timeout='15000ms'`)
    await db.execute(sql`SET LOCAL lock_timeout='3000ms'`)
    if (action !== 'dry-run') {
      await db.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([guildId, channelId])},0))`,
      )
      await db.execute(
        sql`LOCK TABLE public.memories, public.pilot_memories IN SHARE ROW EXCLUSIVE MODE`,
      )
      await db.execute(sql.raw(await readFile('drizzle/legacy-memory-migration.sql', 'utf8')))
      await db.execute(sql`LOCK TABLE memory_migration.entries IN SHARE ROW EXCLUSIVE MODE`)
    }
    const installed = (
      await db.execute(sql`SELECT to_regclass('memory_migration.entries') AS name`)
    ).rows[0].name
    const entries = installed ? await db.select().from(migrationEntries) : []
    // JSON preserves unknown historical physical column types and timestamp precision.
    const source = (
      await db.execute<{ payload: LegacyMemory }>(
        sql`SELECT to_jsonb(m) AS payload FROM public.memories m ORDER BY id`,
      )
    ).rows.map((r) => r.payload)
    const pending: LegacyMemory[] = []
    for (const row of source) {
      if (row.guild_id !== guildId && !(row.guild_id === null && options.approveNullGuild))
        throw new Error('Foreign or unapproved null legacy guild')
      if (
        !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(row.id) ||
        !row.content ||
        row.content.length > 1200
      )
        throw new Error('Invalid legacy identity/content')
      if (source.some((other) => other !== row && other.id.toLowerCase() === row.id.toLowerCase()))
        throw new Error('Legacy identity collision')
      const entry = entries.find((e) => e.id.toLowerCase() === row.id.toLowerCase())
      if (
        entry &&
        (entry.guild_id !== guildId ||
          entry.channel_id !== channelId ||
          ['forgotten', 'imported'].includes(entry.state))
      )
        throw new Error('Legacy identity collision or retired identity')
      const collision = await db
        .select({ id: memories.id })
        .from(memories)
        .where(
          or(
            eq(memories.id, row.id),
            eq(memories.legacyId, row.id),
            and(
              eq(memories.guildId, guildId),
              eq(memories.channelId, channelId),
              sql`${memories.authorId} IS NULL`,
              row.key !== null ? eq(memories.key, row.key) : sql`false`,
            ),
          ),
        )
        .limit(1)
      if (collision.length) throw new Error('Destination identity/key collision')
      if (row.key && source.some((other) => other.id !== row.id && other.key === row.key))
        throw new Error('Duplicate legacy key')
      if (
        ['dry-run', 'import'].includes(action) &&
        !compatibleVector(row, options) &&
        !options.embedding &&
        !options.lexicalOnly
      )
        throw new Error('Embedding regeneration or explicit lexical-only required')
      pending.push(row)
    }
    let imported = 0,
      rolledBack = 0
    for (const row of pending) {
      if (action === 'backup') {
        const existing = entries.find((e) => e.id === row.id)
        if (existing) {
          const same = await db.execute(
            sql`SELECT payload=${JSON.stringify(row)}::jsonb AS same FROM memory_migration.entries WHERE id=${row.id}`,
          )
          if (!same.rows[0].same) throw new Error('Source changed since backup')
        } else
          await db.insert(migrationEntries).values({
            id: row.id,
            guild_id: guildId,
            channel_id: channelId,
            state: 'backed_up',
            payload: row,
          })
      }
      if (action !== 'import') continue
      const backup = await db.execute(
        sql`SELECT payload=${JSON.stringify(row)}::jsonb AS same FROM memory_migration.entries WHERE id=${row.id}`,
      )
      if (!backup.rows[0]?.same) throw new Error('Explicit matching backup required')
      let vector = compatibleVector(row, options)
      let model: string | null = options.model ?? null
      if (!vector) {
        if (options.embedding) {
          try {
            vector = await options.embedding.embed(row.content, AbortSignal.timeout(10000))
          } catch {
            throw new Error('Embedding regeneration failed; transaction rolled back')
          }
          model = options.embedding.model
          if (!validVector(vector) || (options.dimensions && vector.length !== options.dimensions))
            throw new Error('Invalid regenerated vector')
        } else if (options.lexicalOnly) {
          vector = null
          model = null
        } else throw new Error('Embedding regeneration or explicit lexical-only required')
      }
      await db.insert(memories).values({
        id: row.id,
        guildId,
        channelId,
        key: row.key,
        category: row.category,
        content: row.content,
        origin: 'legacy_import',
        legacyId: row.id,
        embedding: vector,
        embeddingModel: model,
        createdAt: sql`${row.created_at}::timestamptz`,
        updatedAt: sql`${row.updated_at}::timestamptz`,
      })
      const verified = await db.execute(
        sql`SELECT 1 FROM pilot_memories WHERE id=${row.id}::uuid AND content=${row.content} AND created_at=${row.created_at}::timestamptz AND updated_at=${row.updated_at}::timestamptz`,
      )
      if (verified.rowCount !== 1) throw new Error('Copy verification failed')
      await db
        .update(migrationEntries)
        .set({
          state: 'imported',
          target_hash: sql`(SELECT md5(to_jsonb(p)::text) FROM pilot_memories p WHERE id=${row.id}::uuid)`,
        })
        .where(eq(migrationEntries.id, row.id))
      await db.execute(sql`DELETE FROM public.memories WHERE id=${row.id}`)
      imported++
    }
    if (action === 'rollback') {
      for (const entry of entries.filter(
        (e) => e.guild_id === guildId && e.channel_id === channelId && e.state === 'imported',
      )) {
        const unchanged = await db.execute(
          sql`SELECT 1 FROM pilot_memories p JOIN memory_migration.entries e ON p.legacy_id=e.id WHERE e.id=${entry.id} AND e.target_hash=md5(to_jsonb(p)::text)`,
        )
        if (unchanged.rowCount !== 1 || !entry.payload)
          throw new Error('Rollback refused: imported record changed or missing')
        await db
          .update(migrationEntries)
          .set({ state: 'rolled_back' })
          .where(eq(migrationEntries.id, entry.id))
        await db.execute(
          sql`INSERT INTO public.memories SELECT (jsonb_populate_record(NULL::public.memories,${JSON.stringify(entry.payload)}::jsonb)).*`,
        )
        await db.delete(memories).where(eq(memories.legacyId, entry.id))
        rolledBack++
      }
    }
    await validate()
    commitAttempted = true
    await db.execute(sql`COMMIT`)
    return {
      pending: pending.length,
      imported,
      rolledBack,
      compatibleVectors: pending.filter((row) => compatibleVector(row, options)).length,
      forgotten: entries.filter(
        (e) => e.state === 'forgotten' && e.guild_id === guildId && e.channel_id === channelId,
      ).length,
    }
  } catch (error) {
    await db.execute(sql`ROLLBACK`).catch(() => undefined)
    if (commitAttempted)
      throw new Error(
        'Migration commit outcome uncertain; inspect dry-run and rerun the same action',
      )
    // Drizzle errors contain SQL/parameters. Never expose their message or nested row data.
    if (error instanceof Error && !(error instanceof DrizzleQueryError) && !('code' in error))
      throw error
    const cause = error instanceof DrizzleQueryError ? error.cause : error
    throw new Error(
      `Migration transaction failed (${cause instanceof Error && 'code' in cause ? cause.code : 'unknown'}); no partial changes committed`,
    )
  } finally {
    client.release()
  }
}
