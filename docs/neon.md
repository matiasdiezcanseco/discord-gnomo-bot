# Neon production PostgreSQL

Use `DATABASE_URL` for the direct endpoint and `DATABASE_URL_POOLED` for the
pooler endpoint. Keep the supplied `sslmode=require&channel_binding=require`
parameters. Set both as deployment secrets; do not commit real URLs or bake
them into Docker images. Drizzle continues to use the existing `pg` driver.

Runtime selects pooled → direct → legacy `PILOT_MEMORY_DATABASE_URL`. Schema
and historical-data migration commands select the direct `DATABASE_URL`, using
the legacy alias only when neither new variable is set. A pooled-only deployment
or a known Neon pooler URL in the direct setting is rejected for migration work.
Use URLs for the same branch/database.

Schema migration needs a direct connection because it uses a session advisory
lock. Runtime uses transaction-local locks/settings and unnamed queries, fitting
transaction pooling. It keeps at most four connections, allows five seconds for
connection establishment/cold wakeups, and retains the two-second SQL timeout
inside transactions. No startup `statement_timeout` is sent through the pooler.

For Neon hosts, the adapter upgrades SSL mode internally to `verify-full` and
rejects explicit insecure modes. Other parameters are retained. Certificate and
hostname verification use trusted roots; local PostgreSQL can still run without TLS.
The adapter explicitly sets pg's `enableChannelBinding:true` for URL modes
`require`/`prefer`. This prefers SCRAM-SHA-256-PLUS when offered; the installed pg
driver does **not** enforce libpq's strict `require` rejection when PLUS is absent.
See [node-postgres SSL/channel binding](https://node-postgres.com/features/ssl).

Export `DATABASE_URL` and run `npm run db:migrate`, or run the packaged
`node dist/database/migrate.js` with that secret. The initial migration creates
pgvector and memory tables; compatible existing records are preserved. Startup
never runs migrations or copies data between providers. `MEMORY_OWNER_ID` remains
required for memory tools. Redis and Discord settings remain unchanged; use the
paused/pilot rollout before enabling production replies.

The sandbox ignores both production variables and stays on its local database.
Development Compose also pins bot/migrator URLs to local PostgreSQL and clears
the pooled setting. Deploy the standard image with production secrets, rather
than using development Compose endpoints. Diagnostics report variable presence only.

Tests verify pooled runtime/direct operator selection, TLS/channel-binding options,
rejection of pooled-only/insecure configuration, and local/legacy compatibility.
The operator CLI test uses real isolated PostgreSQL with both variables set and
an unreachable pooled endpoint, proving migrations use the direct endpoint.
The supplied passwords were redacted: no live Neon connection or production
migration has been performed. Live TLS/authentication, pooler behavior and
cold-start latency remain unverified.

Validation: **194/194 tests, zero skipped**, types/build/lint passed with isolated
PostgreSQL/pgvector and separate Redis AOF restart cases. Docker builds and the
compiled direct migration command passed against local PostgreSQL; the local bot
remains paused. Logs: `plans/neon-verify.log`, `plans/neon-docker-build.log`.
Temporary test containers were removed; no production connection was attempted.

References: [Neon pooling](https://neon.com/docs/connect/connection-pooling),
[direct administrative connections](https://neon.com/docs/connect/connection-errors).
