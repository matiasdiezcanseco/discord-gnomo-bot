import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Pool } from 'pg'
import type { MemoryEmbedding } from '../conversation/explicit-memory'

export type MigrationAction = 'dry-run' | 'backup' | 'import' | 'rollback'
export interface MigrationOptions {
  pool: Pool
  guildId: string
  channelId: string
  /** Trusted Discord lookup, never a model/user supplied channel description. */
  destination(): Promise<{ guildId: string | null; channelId: string }>
  approveNullGuild?: boolean
  legacyModel?: string
  model?: string
  dimensions?: number
  embedding?: MemoryEmbedding
  lexicalOnly?: boolean
}
type Legacy = {
  id: string
  key: string | null
  content: string
  category: string
  guild_id: string | null
  created_at: string
  updated_at: string
  embedding: string | null
}
type Entry = { id: string; guild_id: string; channel_id: string; state: string; payload: Legacy }

function validVector(values: unknown): values is number[] {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.length <= 4096 &&
    values.every(Number.isFinite) &&
    values.some((v) => v !== 0)
  )
}
function compatibleVector(row: Legacy, options: MigrationOptions): number[] | null {
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

/** Operator-only lifecycle; never called by Nest startup. No content in reports/errors. */
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
  const db = await pool.connect()
  let commitAttempted = false
  try {
    await db.query(
      action === 'dry-run' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN',
    )
    await db.query("SET LOCAL statement_timeout='15000ms'")
    await db.query("SET LOCAL lock_timeout='3000ms'")
    if (action !== 'dry-run') {
      // Same lock order as runtime: scope first; table locks also exclude legacy writers.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify([guildId, channelId]),
      ])
      await db.query(
        'LOCK TABLE public.memories, public.pilot_memories IN SHARE ROW EXCLUSIVE MODE',
      )
      await db.query(
        await readFile(resolve(process.cwd(), 'prisma/legacy-memory-migration.sql'), 'utf8'),
      )
      await db.query('LOCK TABLE memory_migration.entries IN SHARE ROW EXCLUSIVE MODE')
    }
    const installed = (await db.query("SELECT to_regclass('memory_migration.entries') AS name"))
      .rows[0].name
    const entries: Entry[] = installed
      ? (await db.query('SELECT * FROM memory_migration.entries')).rows
      : []
    const source: Legacy[] = (
      await db.query('SELECT to_jsonb(m) AS payload FROM public.memories m ORDER BY id')
    ).rows.map((r) => r.payload)
    const pending: Legacy[] = []
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
      const collision = await db.query(
        `SELECT 1 FROM pilot_memories WHERE id=$1::uuid OR legacy_id=$2
        OR (guild_id=$3 AND channel_id=$4 AND author_id IS NULL AND key=$5)`,
        [row.id, row.id, guildId, channelId, row.key],
      )
      if (collision.rowCount) throw new Error('Destination identity/key collision')
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
    let imported = 0
    let rolledBack = 0
    for (const row of pending) {
      if (action === 'backup') {
        const existing = entries.find((e) => e.id === row.id)
        if (existing) {
          const same = await db.query(
            'SELECT payload=$2::jsonb AS same FROM memory_migration.entries WHERE id=$1',
            [row.id, JSON.stringify(row)],
          )
          if (!same.rows[0].same) throw new Error('Source changed since backup')
        } else
          await db.query(
            `INSERT INTO memory_migration.entries VALUES ($1,$2,$3,'backed_up',$4,NULL)`,
            [row.id, guildId, channelId, row],
          )
      }
      if (action !== 'import') continue
      const backup = await db.query(
        'SELECT payload=$2::jsonb AS same FROM memory_migration.entries WHERE id=$1',
        [row.id, JSON.stringify(row)],
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
      await db.query(
        `INSERT INTO pilot_memories
        (id,guild_id,channel_id,key,category,content,origin,legacy_id,embedding,embedding_model,created_at,updated_at)
        VALUES ($1::uuid,$2,$3,$4,$5,$6,'legacy_import',$1::text,$7::vector,$8,$9,$10)`,
        [
          row.id,
          guildId,
          channelId,
          row.key,
          row.category,
          row.content,
          vector ? JSON.stringify(vector) : null,
          model,
          row.created_at,
          row.updated_at,
        ],
      )
      // Verify the data copy with SQL timestamps (including sub-millisecond precision).
      const verified = await db.query(
        `SELECT 1 FROM pilot_memories WHERE id=$1 AND content=$2
        AND created_at=$3::timestamptz AND updated_at=$4::timestamptz`,
        [row.id, row.content, row.created_at, row.updated_at],
      )
      if (verified.rowCount !== 1) throw new Error('Copy verification failed')
      await db.query(
        `UPDATE memory_migration.entries SET state='imported', target_hash=
        (SELECT md5(to_jsonb(p)::text) FROM pilot_memories p WHERE id=$1::uuid) WHERE id=$1`,
        [row.id],
      )
      await db.query('DELETE FROM public.memories WHERE id=$1', [row.id])
      imported++
    }
    if (action === 'rollback') {
      for (const entry of entries.filter(
        (e) => e.guild_id === guildId && e.channel_id === channelId && e.state === 'imported',
      )) {
        const unchanged = await db.query(
          `SELECT 1 FROM pilot_memories p JOIN memory_migration.entries e ON p.legacy_id=e.id
          WHERE e.id=$1 AND e.target_hash=md5(to_jsonb(p)::text)`,
          [entry.id],
        )
        if (unchanged.rowCount !== 1)
          throw new Error('Rollback refused: imported record changed or missing')
        await db.query(`UPDATE memory_migration.entries SET state='rolled_back' WHERE id=$1`, [
          entry.id,
        ])
        await db.query(
          `INSERT INTO public.memories SELECT (jsonb_populate_record(NULL::public.memories,$1)).*`,
          [entry.payload],
        )
        await db.query('DELETE FROM pilot_memories WHERE legacy_id=$1', [entry.id])
        rolledBack++
      }
    }
    await validate()
    commitAttempted = true
    await db.query('COMMIT')
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
    await db.query('ROLLBACK').catch(() => undefined)
    if (commitAttempted)
      throw new Error(
        'Migration commit outcome uncertain; inspect dry-run and rerun the same action',
      )
    // PostgreSQL errors may contain entire rows. Expose only controlled service errors.
    if (error instanceof Error && !('code' in error)) throw error
    throw new Error(
      `Migration transaction failed (${error instanceof Error && 'code' in error ? error.code : 'unknown'}); no partial changes committed`,
    )
  } finally {
    db.release()
  }
}
