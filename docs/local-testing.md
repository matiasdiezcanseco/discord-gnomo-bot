# Local testing and deployed PostgreSQL

For Neon production with `DATABASE_URL` / `DATABASE_URL_POOLED`, see
[Neon deployment](neon.md). Local/sandbox storage stays local.

The bot uses `PILOT_MEMORY_DATABASE_URL` with Drizzle/node-postgres in both environments.
The Docker image contains no database credentials or fixed host. Local Compose
provides PostgreSQL 17/pgvector and reuses the existing `gnomo-redis` container and
its named volume under the original `discord-gnomo-bot` Compose project.

## Local services

```powershell
docker compose up -d postgres redis
```

PostgreSQL listens on `127.0.0.1:5432`; set `LOCAL_POSTGRES_PORT` if occupied.
Its local-only user/password/database are `gnomo` / `gnomo-local` / `gnomo`.
The new `postgres_data` volume persists data. The existing `redis_data` volume
is retained. Do not run `docker compose down --volumes` against retained data.

Schema installation is an explicit Drizzle migration, for fresh and existing
volumes. It creates the vector extension, memory tables and migration journal;
compatible existing tables are adopted without rewriting records. It does not
import old memories. Bot startup never installs or migrates schema.
Use the compiled operator service:

```powershell
docker compose --profile tools build migrate
docker compose --profile tools run --rm --no-deps migrate
```

Copy `.env-example` to `.env` only if `.env` does not already exist, then supply
the live-test configuration described below. Host processes (`npm run dev` or the
measurement runner) use `127.0.0.1` in the example URLs. If changing the published
Postgres port, update the host URL too. Local Redis uses logical database **15**,
separate from the older runtime's default database 0. Database 15 is not temporary;
do not clear it if it contains pilot notices or deduplication state.

For a containerized paused bot:

```powershell
docker compose --profile bot up -d --build bot
Invoke-RestMethod http://127.0.0.1:3000/health/diagnostics
```

The bot service substitutes `postgres:5432` and `redis:6379` for container networking.
It reads optional `.env`/`.env.local` files, but `RUNTIME_MODE` defaults explicitly
to paused and must be set in `.env` or the shell to enable pilot mode. Configure
`RUNTIME_CHANNEL_IDS` before selecting pilot. `LOCAL_BOT_PORT` changes the published
HTTP port. No secrets enter the image build context. In paused mode diagnostics
returns 200; readiness remains 503 because Discord is disconnected.

If PostgreSQL is already running on the host instead, run the image directly with
`PILOT_MEMORY_DATABASE_URL` using `host.docker.internal` on Docker Desktop and your
host's port. `127.0.0.1` inside a container refers to that container itself.

## Supabase deployment

Build/deploy the same Dockerfile without the local Compose stack. Set the deployed
`PILOT_MEMORY_DATABASE_URL` secret to the connection URL copied from Supabase's
Connect panel. Prefer the direct connection for this long-running bot, or the
session pooler when the deployment network requires IPv4. The runtime keeps at
most four database connections. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

Use verified TLS, for example append
`?sslmode=verify-full&sslrootcert=/run/certs/supabase-ca.crt` (use `&` if the URL
already has query parameters). Mount the project's downloaded root CA at that
path at runtime; it is not included in the image. A server certificate trusted by
Node's system roots needs only `sslmode=verify-full`. Do not disable certificate
verification. See [Supabase SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement).

Before activation, an operator runs `npm run db:migrate` with the intended database
URL and a role permitted to install/use vector and create tables/journal. The
runtime role needs the corresponding memory-table/index/extension access. Legacy
imports remain the separate backup/dry-run/import process in
[migration operations](tickets/gnomo-refactor/11-migration-operations.md); neither
local setup nor deployment imports old data automatically. Supply the deployment's
Redis URL separately; local Redis/DB credentials are never deployment defaults.
See [Drizzle migration and existing-data operations](drizzle.md).

The existing Redis configuration is retained. For durable reminder/birthday
acceptance, its AOF is currently disabled; enable persistent AOF with
`appendfsync always` (or provide an equivalent durability guarantee), as described
in [reliable reminders](reliable-reminders.md). Connection success alone does not
certify crash durability.

## Inputs still needed for live acceptance

For unrestricted local conversations without reaching Discord, use the
[sandbox](sandbox.md). It needs no Discord credentials or human server messages.
The following requirements apply specifically to later Discord transport acceptance.

- Private `BOT_TOKEN`, `OPENAI_API_KEY`, an explicit `OPENAI_MODEL`, and
  `TAVILY_API_KEY` for real search/news. `BUCKET_URL` is needed to test the existing
  phrases/photos/birthday collection; an embedding model is optional.
- `GUILD_ID`, one isolated test channel ID, the human test requester's Discord ID,
  and trusted `MEMORY_OWNER_ID`. `GNOMOS_CHANNEL_ID` selects the birthday/migration
  destination. Enable Message Content, Server Members and Presence privileged
  intents, with channel read/history/send permissions.
- Only one bot receiver in that channel: stop the ordinary local/production
  receiver before starting the measurement receiver. Configure `T14_REDIS_URL`
  with the local host URL above, `T14_CHANNEL_ID`, `T14_REQUESTER_ID`, and
  `T14_EXCLUSIVE_RECEIVER=yes`. The measurement runner does not dispatch scheduled
  reminders or birthdays; those require a separate normal-runtime pilot.
- A human sends real tagged invocations and judges usefulness/personality/sources.
  Use `npm run measure:live` with an explicitly supplied private `T14_ENV_FILE`.
  See [sampling and reporting](compound-conversations.md#runner-vivo-acotado-para-root).
  Check simple responses against 3 seconds and tool/compound responses against
  15 seconds, including partial/failure rates. Controlled tests do not certify
  these real-service targets.

Local infrastructure checks can run without credentials. Supabase TLS/connectivity,
live providers, Discord behavior, human acceptance and latency remain unverified
until those environments and inputs are actually exercised.

## Verified locally (2026-11-06)

`docker compose config --quiet` and the real bot image build passed. The new local
database is healthy with vector 0.8.7 and both memory tables. From inside the bot
container, compiled `RuntimeMemory` connected and passed vector query plus
insert/read/rollback checks; the existing Redis responded to PING. Diagnostics
returned 200/paused with PostgreSQL and Redis configured; readiness returned the
expected 503 for disconnected Discord. No live credentials were present.

The existing explicit-memory behavior tests passed **2/2, zero skipped** against
the local PostgreSQL and existing Redis database 15, including memory writes,
recall, consent/permissions, concurrent operations and pool recreation. This is
targeted validation of these configuration changes; the earlier 182-test full
integration result is separate. PostgreSQL, Redis and the paused bot are left
running for local testing. No Supabase connection, deployment or legacy import
was performed.
