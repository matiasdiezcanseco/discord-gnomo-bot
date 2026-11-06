-- T10 additive storage. Apply explicitly; safe on a fresh pgvector database.
-- Deliberately independent of legacy migrations and the legacy memories table.
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS pilot_memories (
  id uuid PRIMARY KEY,
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  author_id text,
  subject text,
  key text,
  category text NOT NULL DEFAULT 'general',
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 1200),
  source_message_id text,
  last_message_id text,
  last_editor_id text,
  origin text NOT NULL CHECK (origin IN ('explicit_request','legacy_import')),
  legacy_id text UNIQUE,
  embedding vector,
  embedding_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((embedding IS NULL) = (embedding_model IS NULL))
);
CREATE INDEX IF NOT EXISTS pilot_memories_scope ON pilot_memories(guild_id, channel_id);
CREATE UNIQUE INDEX IF NOT EXISTS pilot_memories_author_key
  ON pilot_memories(guild_id, channel_id, author_id, key) WHERE key IS NOT NULL;
CREATE TABLE IF NOT EXISTS pilot_memory_operations (
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  message_id text NOT NULL,
  author_id text NOT NULL,
  operation text NOT NULL,
  memory_id uuid REFERENCES pilot_memories(id) ON DELETE SET NULL,
  PRIMARY KEY (guild_id, channel_id, message_id)
);
COMMIT;
