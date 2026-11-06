import { getTableConfig } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { memories, memoryOperations } from './schema'
import type { memoryDatabase } from './connection'

const normalize = (text: string) => text.replace(/["\s]/g, '').replaceAll('public.', '')

/** Refuse to mark an incompatible pre-Drizzle database as successfully migrated. Read-only. */
export async function validateBaseline(db: ReturnType<typeof memoryDatabase>) {
  const history = await db.execute(sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS name`)
  if (
    history.rows[0].name &&
    (await db.execute(sql`SELECT 1 FROM drizzle.__drizzle_migrations LIMIT 1`)).rowCount
  )
    return
  const present = await db.execute(
    sql`SELECT to_regclass('public.pilot_memories') AS memories, to_regclass('public.pilot_memory_operations') AS operations`,
  )
  if (!present.rows[0].memories && !present.rows[0].operations) return
  const incompatible = () => {
    throw new Error(
      'Existing memory schema is incompatible; inspect and reconcile before Drizzle adoption',
    )
  }
  if (!present.rows[0].memories || !present.rows[0].operations) incompatible()
  for (const table of [memories, memoryOperations]) {
    const definition = getTableConfig(table)
    const columns = await db.execute<{
      name: string
      type: string
      not_null: boolean
      default_value: string | null
    }>(sql`
      SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null,
      pg_get_expr(d.adbin,d.adrelid) AS default_value
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND c.relname=${definition.name} AND a.attnum>0 AND NOT a.attisdropped`)
    for (const column of definition.columns) {
      const installed = columns.rows.find((row) => row.name === column.name)
      if (
        !installed ||
        installed.type !== column.getSQLType() ||
        installed.not_null !== column.notNull
      )
        incompatible()
      if (column.name === 'category' && installed?.default_value !== "'general'::text")
        incompatible()
      if (
        ['created_at', 'updated_at'].includes(column.name) &&
        installed?.default_value !== 'now()'
      )
        incompatible()
    }
  }
  const constraints = await db.execute<{ table_name: string; definition: string }>(sql`
    SELECT c.relname AS table_name, pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('pilot_memories','pilot_memory_operations')`)
  const required = [
    ['pilot_memories', 'PRIMARY KEY (id)'],
    ['pilot_memories', 'UNIQUE (legacy_id)'],
    ['pilot_memories', 'CHECK (((embedding IS NULL) = (embedding_model IS NULL)))'],
    ['pilot_memories', 'CHECK (((length(content) >= 1) AND (length(content) <= 1200)))'],
    [
      'pilot_memories',
      "CHECK ((origin = ANY (ARRAY['explicit_request'::text, 'legacy_import'::text])))",
    ],
    ['pilot_memory_operations', 'PRIMARY KEY (guild_id, channel_id, message_id)'],
    [
      'pilot_memory_operations',
      'FOREIGN KEY (memory_id) REFERENCES pilot_memories(id) ON DELETE SET NULL',
    ],
  ]
  for (const [table, definition] of required)
    if (
      !constraints.rows.some(
        (row) => row.table_name === table && normalize(row.definition) === normalize(definition),
      )
    )
      incompatible()
  const indexes = await db.execute<{
    name: string
    valid: boolean
    is_unique: boolean
    columns: string[]
    predicate: string | null
  }>(sql`
    SELECT c.relname AS name, i.indisvalid AS valid, i.indisunique AS is_unique,
    ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=key.attnum ORDER BY key.ord)::text[] AS columns,
    pg_get_expr(i.indpred,i.indrelid) AS predicate
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.pilot_memories'::regclass`)
  for (const [name, columns, unique, predicate] of [
    ['pilot_memories_scope', ['guild_id', 'channel_id'], false, null],
    [
      'pilot_memories_author_key',
      ['guild_id', 'channel_id', 'author_id', 'key'],
      true,
      '(key IS NOT NULL)',
    ],
  ] as const) {
    const index = indexes.rows.find((row) => row.name === name)
    if (
      !index?.valid ||
      index.is_unique !== unique ||
      JSON.stringify(index.columns) !== JSON.stringify(columns) ||
      normalize(index.predicate ?? '') !== normalize(predicate ?? '')
    )
      incompatible()
  }
}
