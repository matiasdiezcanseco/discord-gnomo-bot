import { jsonb, pgSchema, text } from 'drizzle-orm/pg-core'

export type LegacyMemory = {
  id: string
  key: string | null
  content: string
  category: string
  guild_id: string | null
  created_at: string
  updated_at: string
  embedding: string | null
}

// Installed with source-guard/forget triggers by the operator, not by runtime migrations.
export const migrationEntries = pgSchema('memory_migration').table('entries', {
  id: text('id').primaryKey(),
  guild_id: text('guild_id').notNull(),
  channel_id: text('channel_id').notNull(),
  state: text('state', { enum: ['backed_up', 'imported', 'rolled_back', 'forgotten'] }).notNull(),
  payload: jsonb('payload').$type<LegacyMemory>(),
  target_hash: text('target_hash'),
})
