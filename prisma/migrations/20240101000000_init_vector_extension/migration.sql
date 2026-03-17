CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE memories ALTER COLUMN embedding TYPE vector(1536) USING embedding::vector(1536);

CREATE INDEX IF NOT EXISTS memories_embedding_idx ON memories 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
