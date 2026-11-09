# Gnomo

Personal Discord assistant for one configured guild. Mention the bot to converse,
request phrases/photos, channel history, members/presence/voice, public search and
web reading, image understanding, explicit channel memories and own reminders.
Birthdays use the approved collection and the same reliable notice dispatcher.

To debug locally without Discord, run `npm run sandbox`: the full production runtime
(real model, tools, memory, reminders, schedulers) with the terminal as transport and
only local PostgreSQL/Redis. See [sandbox usage](docs/sandbox.md).

To diagnose production behavior from the logs, see [debugging](docs/debugging.md).

Install Node 24 and run `npm ci --ignore-scripts`. Copy `.env-example` to `.env`.
`npm start` defaults to **paused**, without logging into Discord. Configure the
required variables before selecting `RUNTIME_MODE=pilot` (explicit comma-separated
`RUNTIME_CHANNEL_IDS`) or `guild` (all effectively authorized channels in GUILD_ID).
`OPENAI_MODEL` is honored; the example retains gpt-5-mini and the established code
fallback remains gpt-4o-mini. No silent model replacement is performed.

For local PostgreSQL/pgvector, the existing Redis and an optional containerized bot,
follow [local testing and Supabase deployment](docs/local-testing.md). The same
Docker image accepts Neon or Supabase connection URLs at deployment time.

Active mode requires BOT_TOKEN, GUILD_ID, OPENAI_API_KEY and REDIS_URL. Redis stores
deduplication and durable notices, not a permanent conversation archive. Context
comes from the current channel/thread, bounded and reauthorized. Ambient messages,
bots, other guilds and DMs do not invoke Gnomo.

Optional capabilities require BUCKET_URL (phrases/photos/birthday JSON),
TAVILY_API_KEY (search/news), or DATABASE_URL/DATABASE_URL_POOLED plus trusted
MEMORY_OWNER_ID (17–20 digit Discord ID) for explicit memories. Optional
PILOT_MEMORY_EMBEDDING_MODEL enables embeddings; omission uses lexical retrieval.
Neon runtime uses the pooled URL; migrations use the direct URL. The older
PILOT_MEMORY_DATABASE_URL remains a fallback alias. See [Neon deployment](docs/neon.md).
GNOMOS_CHANNEL_ID is required for birthdays and the approved memory migration
destination. Time expressions and birthdays use America/Lima. Omit unused optional
variables. Missing capability configuration produces unavailable results.

Enable Guilds, GuildMessages, MessageContent, GuildMembers, GuildPresences and
GuildVoiceStates intents; enable privileged intents in the Discord developer portal.
Grant ViewChannel, ReadMessageHistory, SendMessages/SendMessagesInThreads as needed.
Private threads also require membership. Execution and delivery recheck effective
permissions. No administrative permissions are needed. Role/everyone/here mentions
are disabled; only explicitly authorized individual recipients may be notified.

`npm run verify` runs behavior tests, types, build and lint. Persistence cases report
skips without explicit isolated test URLs. For a complete run with your own Docker
resources, use [the transition runbook](docs/runtime-transition.md). Persistence uses
Drizzle ORM over node-postgres with versioned migrations. When a database is
configured, server startup automatically applies pending migrations before
Discord login, scheduled jobs or HTTP listening; failure aborts startup. Applied
migrations are skipped. The console sandbox runs the same startup migrations.
See [Drizzle operations](docs/drizzle.md).

`GET /health` checks Discord readiness, configured Redis and optional bucket.
Paused Discord is not ready. `GET /health/diagnostics` reports rollout mode, model
and configuration presence without secrets, content or network probes. Protect the
HTTP service within the deployment network. Trace events identify invocation,
status, steps, external calls and elapsed time without bodies or raw errors.

Architecture, transition/rollback, coverage and external acceptance gates:
[docs/runtime-transition.md](docs/runtime-transition.md). Live runner and unchanged
sampling limits: [docs/compound-conversations.md](docs/compound-conversations.md).
Startup migrates the configured database schema, including in paused mode; it
never imports legacy data or changes rollout mode. Builds do not run migrations.

Build the production image with `docker build -t gnomo .`; it starts with
`node dist/main.js`. For a local paused smoke,
use `docker run --rm -p 127.0.0.1:3000:3000 gnomo`. Diagnostics should report paused;
`/health` returns 503 while Discord is deliberately disconnected. SQL/operator
artifacts and the compiled Drizzle migrator remain packaged. Startup and the
manual `db:migrate` command share the same journal and serialization lock. Run TypeScript
operator scripts from an operator installation with development dependencies.
Real Docker validation evidence is in [the final review report](docs/final-code-review.md).
