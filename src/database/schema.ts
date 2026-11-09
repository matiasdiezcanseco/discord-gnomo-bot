import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// Model/dimension compatibility is checked at query time; existing rows can have different dimensions.
const embeddingVector = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector',
  toDriver: JSON.stringify,
  fromDriver: (value) => JSON.parse(value),
})

export const memories = pgTable(
  'pilot_memories',
  {
    id: uuid('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    authorId: text('author_id'),
    subject: text('subject'),
    key: text('key'),
    category: text('category').notNull().default('general'),
    content: text('content').notNull(),
    sourceMessageId: text('source_message_id'),
    lastMessageId: text('last_message_id'),
    lastEditorId: text('last_editor_id'),
    origin: text('origin', { enum: ['explicit_request', 'legacy_import'] }).notNull(),
    legacyId: text('legacy_id').unique('pilot_memories_legacy_id_key'),
    embedding: embeddingVector('embedding'),
    embeddingModel: text('embedding_model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('pilot_memories_scope').on(table.guildId, table.channelId),
    uniqueIndex('pilot_memories_author_key')
      .on(table.guildId, table.channelId, table.authorId, table.key)
      .where(sql`${table.key} IS NOT NULL`),
    check('pilot_memories_content_check', sql`length(${table.content}) BETWEEN 1 AND 1200`),
    check(
      'pilot_memories_origin_check',
      sql`${table.origin} IN ('explicit_request','legacy_import')`,
    ),
    check(
      'pilot_memories_check',
      sql`(${table.embedding} IS NULL) = (${table.embeddingModel} IS NULL)`,
    ),
  ],
)

export const memoryOperations = pgTable(
  'pilot_memory_operations',
  {
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    authorId: text('author_id').notNull(),
    operation: text('operation').notNull(),
    memoryId: uuid('memory_id'),
  },
  (table) => [
    primaryKey({
      columns: [table.guildId, table.channelId, table.messageId],
      name: 'pilot_memory_operations_pkey',
    }),
    foreignKey({
      columns: [table.memoryId],
      foreignColumns: [memories.id],
      name: 'pilot_memory_operations_memory_id_fkey',
    }).onDelete('set null'),
  ],
)

/** Preserve the existing tool response contract while using camelCase schema properties. */
export const memoryRecord = {
  id: memories.id,
  guild_id: memories.guildId,
  channel_id: memories.channelId,
  author_id: memories.authorId,
  subject: memories.subject,
  key: memories.key,
  category: memories.category,
  content: memories.content,
  source_message_id: memories.sourceMessageId,
  last_message_id: memories.lastMessageId,
  last_editor_id: memories.lastEditorId,
  origin: memories.origin,
  created_at: memories.createdAt,
  updated_at: memories.updatedAt,
}

/** Images members explicitly asked Gnomo to keep; the bytes live in object storage. */
export const channelMedia = pgTable(
  'channel_media',
  {
    id: uuid('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    authorId: text('author_id').notNull(),
    sourceMessageId: text('source_message_id').notNull(),
    sourceAttachmentId: text('source_attachment_id').notNull(),
    objectKey: text('object_key').notNull().unique('channel_media_object_key_key'),
    url: text('url').notNull(),
    mediaType: text('media_type').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    embedding: embeddingVector('embedding'),
    embeddingModel: text('embedding_model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('channel_media_scope').on(table.guildId, table.channelId, table.createdAt),
    // One copy per channel: saving the same bytes again returns the existing entry.
    uniqueIndex('channel_media_content').on(table.guildId, table.channelId, table.sha256),
    check('channel_media_title_check', sql`length(${table.title}) BETWEEN 1 AND 100`),
    check('channel_media_description_check', sql`length(${table.description}) BETWEEN 1 AND 1500`),
    check(
      'channel_media_embedding_check',
      sql`(${table.embedding} IS NULL) = (${table.embeddingModel} IS NULL)`,
    ),
  ],
)
