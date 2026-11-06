# Historical memory storage

The retired runtime stored global memories in `public.memories`: id, key,
content, embedding, category, guild_id, created_at and updated_at. Its source
declaration represented IDs/embeddings as strings; installations also used
physical UUID IDs and pgvector embeddings, including vectors of dimension 1536.
Existing variants are read as JSONB during explicit operator import, without
assuming that the retired source declaration matches the physical types.

The new Drizzle migration owns only `pilot_memories` and
`pilot_memory_operations`. It does not create/alter/drop the old `memories`
table or reconstruct a retired vector index. Old schema and vector-upgrade
artifacts remain available in Git history, not in the active installation path.
Private import ledger entries and forget/source triggers must be preserved.

See [import operations](tickets/gnomo-refactor/11-migration-operations.md) and
[Drizzle setup](drizzle.md). No legacy data is imported by application startup,
database schema migration or sandbox setup.
