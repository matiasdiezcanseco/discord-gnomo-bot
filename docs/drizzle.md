# Drizzle persistence and migrations

Drizzle ORM 0.45.4 owns the typed memory schema and query construction; the
node-postgres driver still owns connections. Drizzle Kit 0.31.11 generates schema
changes. Prisma client, generator, schema and migration artifacts are removed.
Table/column names, IDs, channel scope, authorship, operation receipts and tool
response fields remain compatible with the preceding implementation.

`src/database/schema.ts` defines the two runtime tables, checks, unique indexes,
foreign key and dimension-independent pgvector column. Memory CRUD uses typed
Drizzle queries; PostgreSQL-specific locks, vector expressions and historical
JSON copies use parameterized Drizzle SQL. Work stays on the same pinned client
through BEGIN/COMMIT/ROLLBACK, preserving cancellation revalidation, advisory
locks and uncertain-write handling. SQL logging is disabled. Migration errors
do not expose Drizzle's SQL/parameter payloads.

## Operator commands

```powershell
npm run db:generate
npm run db:check
$env:PILOT_MEMORY_DATABASE_URL='<reviewed PostgreSQL connection URL>'
npm run db:migrate
```

`db:generate` reads only the TypeScript schema/snapshot and writes migration SQL
and metadata under `drizzle/`. Review and commit these files together.
`db:check` checks migration metadata. Neither needs a live database.
`db:migrate` applies committed migrations and records them in
`drizzle.__drizzle_migrations`. It loads `.env.local`/`.env` for this explicit
operator invocation; `DB_ENV_FILE` selects another private file. Exported variables
take precedence. Never point test URLs at production.

Startup/build do not migrate databases. The runtime role needs table access;
the migration operator additionally needs schema/table/extension creation rights.
Keep the public memory tables and vector extension visible on the connection's
search path. Supabase direct/session connection URLs and verified TLS are
configured as in [local and deployment setup](local-testing.md).

For Docker's local PostgreSQL:

```powershell
docker compose up -d postgres redis
docker compose --profile tools build migrate
docker compose --profile tools run --rm --no-deps migrate
```

The image packages `drizzle/` and `dist/database/migrate.js`; it does not require
Drizzle Kit or tsx at runtime. The normal entry remains `node dist/main.js`.
The local Postgres service no longer mounts an SQL initializer; installation
and journal tracking use the same explicit migration path for every volume.

Sandbox installation remains `npm run sandbox:setup` (or its compiled Docker
equivalent). It creates/adopts only the isolated local sandbox database and calls
the same Drizzle migrator. No Discord connection is involved.

## Existing databases

The initial migration is additive and uses compatible physical names. Before
creating its journal on a pre-Drizzle installation, the operator wrapper checks
column types/nullability/defaults, required constraints and scope/unique indexes.
Missing/incompatible tables refuse adoption without creating a migration journal;
inspect/reconcile them explicitly rather than dropping data. A fresh database is
installed normally. Compatible existing records are not copied or rewritten.
A session advisory lock serializes concurrent wrapper invocations, including
initial journal creation. Failed migration SQL rolls back through Drizzle.

Back up data and quiesce affected writers before production schema changes. Keep
applied SQL/metadata immutable; generate another migration for subsequent changes.
Use `db:migrate`, not `drizzle-kit push` or direct Kit migration, so the adoption
and serialization checks run. No deployment or production migration was performed
as part of this source change.

## Legacy memory import is separate

`memory:migrate` still performs explicit dry-run/backup/import/rollback. It uses
Drizzle queries and JSONB for historical text/UUID/vector variants and preserves
SQL timestamp precision. Its private ledger schema is typed separately in
`src/memory-migration/schema.ts`. The trusted
`drizzle/legacy-memory-migration.sql` installs its checks, source guard and forget
trigger inside the backup/import transaction. It is not in the runtime migration
journal because it depends on the historical source table being present.

Do not drop or recreate an existing migration ledger/trigger to adopt Drizzle.
Forgotten identities remain retired and imported records cannot silently return
to legacy storage. See [legacy operations](tickets/gnomo-refactor/11-migration-operations.md).
The historical schema's meaning is documented in
[legacy storage](legacy-memory-schema.md); it is not an active Prisma model.

## Verification

The regression installs a fresh database, adopts existing memory records with
two concurrent migration calls, checks stable IDs/content and one journal entry,
and refuses altered nullability without recording a baseline. It uses only the
explicit isolated `DRIZZLE_TEST_DATABASE_URL` database named `gnomo_drizzle` on
loopback. Existing conversation/memory/legacy/sandbox tests exercise the Drizzle
queries against real PostgreSQL/pgvector. No tests import production data.

Final validation: **190/190 tests, zero skipped**, types/build/lint and Drizzle
metadata checks passed. `db:generate` reports no schema changes after the committed
snapshot. Isolated Redis instances exercised T12/T13 AOF restart cases. Log:
`plans/drizzle-verify-final.log`. The optional isolated PostgreSQL restart branch was
not enabled in this run.

Real Docker builds passed for the migrator, sandbox and paused app. The compiled
migrator/setup ran against both local databases, each with one baseline journal
entry. After recreating the local Postgres container without the obsolete SQL
mount, sandbox recall retained the previous memory ID/content/timestamps. The
packaged image contains Drizzle SQL/journal/compiled CLI and no Prisma directory
or client. Local services are retained; temporary regression resources removed.
Supabase connectivity, live providers and Discord acceptance remain unperformed.

Implementation references: [Drizzle with node-postgres](https://orm.drizzle.team/docs/get-started-postgresql),
[migration history](https://orm.drizzle.team/docs/drizzle-kit-migrate),
[parameterized SQL](https://orm.drizzle.team/docs/sql),
[custom column types](https://orm.drizzle.team/docs/custom-types).
