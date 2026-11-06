# T15: runtime and transition preparation

Code/preparation only. Live Discord/provider measurement, human acceptance,
ACTUAL pilot and production cutover are **UNPERFORMED**. Two private configuration
cards expired without credentials. T14/T15 acceptance remains gated; PR18 stays a
draft, issues remain open. Controlled replies never certify production latency.

## Final architecture

Nest composes one MessageHandlerService and one conversation instance. The receiver
normalizes authenticated events and applies trusted runtime policy. Conversation
owns admission, event claims, channel ordering, context, independent five-generation
and eight-external-call budgets, cancellation at 12 seconds and delivery by 15.
Catalog/Executor validate contracts, current permissions and effects, including
fast paths. Persona and the AI SDK adapter are separate from execution policy.

`composeConversation({ client, config, redis, trace?, model?, discordFetch?, web?,
memory? })` in modules/discord is the adapter composition root. `composeCapabilities`
in conversation accepts typed named dependencies and optional `extensions` of
validated Capability definitions. Add domain capability definitions there; keep
Discord/storage/provider details behind their respective boundary interfaces.
Catalog rejects duplicate/invalid contracts; registering never grants authorization.
New capabilities also need trusted execution policy and behavioral coverage.

Retired: core/orchestrator, core/tools and registry, autosave/enrichers/context,
old global-memory/embedding/Prisma runtime, Redis conversation history, old Discord
utilities/handler branch and ReminderCheckTask. No legacy runtime fallback remains.
The normalized core/conversation invocation contract remains shared. BirthdayCheckTask
produces durable records; ReliableNoticesTask is the sole birthday/reminder sender.
Migration service, SQL installer, T11 ledger/backup/triggers/tombstones and legacy
reminder transfer remain operator infrastructure. No data table or payload was
removed to retire source code. SQL/table/environment names containing `pilot` remain
stable storage contracts, not a duplicate runtime.

Unused packages removed after source-consumer search: opus (no audio), Tavily SDK
(search uses bounded fetch), node-cron (Nest owns scheduling), tsup (Nest builds),
class-transformer/class-validator (no request DTOs; unused global ValidationPipe
removed), Prisma client/adapter/CLI. Persistence now uses Drizzle ORM over pg;
Prisma schema/tooling is removed. Explicit `db:generate`, `db:check` and `db:migrate`
manage the new schema; see [Drizzle operations](drizzle.md). No model/AI SDK version
upgrade was requested or performed.

## Rollout and rollback

`RUNTIME_MODE=paused` is the default and never falls back. `pilot` admits only the
explicit RUNTIME_CHANNEL_IDS; `guild` admits the configured guild, still requiring
fresh permissions. Mode changes are deployment configuration: stop admission, drain
in-flight invocation work (15 seconds) and notice leases (30 seconds, inspect any
uncertain send), stop the old process, change configuration and start exactly one
process. Do not run mixed-version receivers/workers. Environment edits require a
restart; these are not Discord commands. Missing/invalid active configuration fails
startup. Old CONVERSATION_PILOT_CHANNEL_IDS no longer selects a legacy branch.

1. Before a real pilot, obtain the owner's private configuration, review intents,
   permissions, model identity and bucket resources, and take controlled durable
   backups. Stop/drain every older receiver and scheduler. Keep default paused.
2. Operator explicitly runs `npm run db:migrate` against the chosen PostgreSQL/
   pgvector database. Startup never executes DDL. For existing
   memories, follow [T11 operations](tickets/gnomo-refactor/11-migration-operations.md):
   dry-run, backup, import, verify. T11 needs old and new tables in the same database.
   Do not replace or drop the ledger/triggers/tombstones. The application role must
   not read migration backup payloads.
3. Explicitly transfer old pending reminders with stopped legacy workers:
   configure REDIS_URL, GUILD_ID, BOT_TOKEN and RUNTIME_CHANNEL_IDS for all channels
   being transferred, then `npm run notices:transfer -- --apply`. The CLI does not
   autoload dotenv: export the reviewed configuration. It checks channel guilds,
   preserves raw legacy payloads, saves stable new identities first, then removes
   matching old due-index entries. Malformed/foreign/unselected entries stay retained.
   Inspect every retained entry; repeat transfer safely, never silently discard it.
4. Start one runtime in pilot mode. Verify all capabilities, isolation, mentions,
   pending notices and current permissions, then run the bounded live measurement
   and human evaluation in compound-conversations.md. Only the owner/root can
   approve subsequent guild rollout. No step above was executed on real data here.
5. Supported configuration rollback is guild → pilot or paused on this safe runtime.
   Durable memories, notices, attempts, deduplication and migration metadata remain.
   Out-of-rollout notices stay pending without consuming attempts. Paused schedulers
   produce/send nothing. Resume using the same databases/Redis namespace. Safe
   mentions, channel scope and explicit consent are never toggled off.
6. Data rollback of an untouched import is the explicit T11 `rollback` command:
   atomic, repeatable, refuses post-import edits/collisions. Edited memories cannot
   be losslessly reverted to an old schema by restoring a stale backup. Freeze all
   writers, retain a complete current backup and reconcile IDs/content/dates and
   tombstones manually with operator review; otherwise keep the new storage and
   resume a compatible safe runtime. Forgotten identities must stay forgotten.
7. Reverting to a pre-refactor binary is **not a supported active rollback**: it
   restores unsafe global recall/autosave/mention paths and cannot understand new
   notice state. Keep such binaries stopped. Never repopulate old reminder due
   indexes from raw payloads without reconciling new sent/uncertain/dead records;
   that would duplicate notifications. If release rollback is needed, use a release
   retaining this policy/storage contract or stay paused during reconciliation.

## Controlled evidence and characterization mapping

Tests exercise normalized invocation → visible reply/effects, fake Discord/model/web,
and real isolated PostgreSQL/vector/Redis. The compiled production Nest smoke uses
actual AppModule and HTTP adapter initialization/shutdown, with controlled Discord
login and web. Unconfigured startup forbids login/fetch/DB connection, observes one
receiver and exactly birthday-check/reliable-notices jobs, and removes the receiver
on close. Active controlled startup admits duplicate events through the real single
receiver and Redis claim and yields one safe collection reply; no real model is used.

Legacy characterization outcomes remain at the new seams:

| Outcome | Current coverage |
| --- | --- |
| Greeting/persona reply, no ambient/bot/foreign work | conversation, invocation, harness-routing |
| Saved phrase and photo URL | collection-content, active runtime-startup |
| Member nickname resolution | members (complete REST boundary, ambiguity and mention safety) |
| Memory unavailable without false success | explicit-memory (also actual SQL save/search/update/forget) |
| Reminder unavailable, saved requester/channel delivery | reminders (real Redis, safe mentions, no lost transient failures) |
| Birthday with no Redis sends nothing | birthdays, runtime-startup (no legacy send exists) |
| Web result and source visible | public-search, public-web, compound-conversation |
| Attached image reaches model | attached-images (verified bytes rather than trusting remote URL) |

Old behavior that conflicts with approved scope (global recall, autosave, unsafe
mentions, discard-on-send-error) is intentionally not preserved. The previous 12
legacy conversation tests became two new conversation tests with the other outcomes
covered above; routing characterization was replaced by rollout/pause coverage.
New startup and rollback tests explain why totals differ from the 181-test baseline.
T11 still tests untouched import rollback, refusal after edits, reimport, physical
forget/backup purge and antiresurrection. Explicit-memory tests pause/recreate/resume
and recover the same memory without persisting a denied write. Reminder rollback
uses real Redis and actual scheduled Discord adapter: paused/excluded states retain
pending/zero attempts; concurrent resume produces one safe send. T12/T13 AOF tests
restart separate Redis servers and recover notices.

## Reproduce using exclusively your own resources

Node 24, Docker Desktop Linux engine, pgvector PostgreSQL 17 and Redis 7. The following
names/ports belong to this worktree's T15 run; choose new names/ports if occupied.
Do not reuse another implementer's containers. PostgreSQL T10 and T11 databases are
separate (T11 recreates synthetic legacy tables). No shared FLUSHDB or real migration.

```powershell
npm ci --ignore-scripts
docker run --detach --name gnomo-t15-d21c-postgres --env POSTGRES_PASSWORD=t15-only --env POSTGRES_DB=gnomo_t11 --publish 127.0.0.1:16550:5432 pgvector/pgvector:pg17
# Wait for pg_isready before CREATE DATABASE.
docker exec gnomo-t15-d21c-postgres pg_isready -U postgres
docker exec gnomo-t15-d21c-postgres psql -U postgres -c 'CREATE DATABASE gnomo_t10'
docker run --detach --name gnomo-t15-d21c-redis --publish 127.0.0.1:16551:6379 redis:7-alpine
docker run --detach --name gnomo-t15-d21c-t12 --publish 127.0.0.1:16552:6379 redis:7-alpine redis-server --appendonly yes
docker run --detach --name gnomo-t15-d21c-t13 --publish 127.0.0.1:16553:6379 redis:7-alpine redis-server --appendonly yes
$env:T10_DATABASE_URL='postgresql://postgres:t15-only@127.0.0.1:16550/gnomo_t10'
$env:T11_DATABASE_URL='postgresql://postgres:t15-only@127.0.0.1:16550/gnomo_t11'
$env:T02_REDIS_URL='redis://127.0.0.1:16551'
$env:T12_REDIS_RESTART_URL='redis://127.0.0.1:16552'
$env:T12_REDIS_CONTAINER='gnomo-t15-d21c-t12'
$env:T13_REDIS_RESTART_URL='redis://127.0.0.1:16553'
$env:T13_REDIS_CONTAINER='gnomo-t15-d21c-t13'
npm run verify
git diff --check
```

No T10_RESTART_CONTAINER: that optional in-test branch is guarded to another
name/port. Its absence does not register a skipped test; new SQL clients are still
verified. T15 did not repeat a PostgreSQL server restart. T12/T13 actually restart
distinct owned AOF servers; ECONNREFUSED during reconnect is expected before recovery.
Missing persistence URLs explicitly skip their cases; never count that as full
verification. No real latency, semantic provider benchmark or human acceptance is
inferred from these tests. Owner controls later cleanup of the four named resources.

Final local evidence, 2026-11-06: merged latest LOCAL integration/gnomo-harness
before final checks (Already up to date at 5dd43fe9bbab2618a125a96675ff5537116f2ba3).
Fresh `npm ci --ignore-scripts` succeeds without Prisma/code generation. Final
`npm run verify` exits 0: **174/174 tests, zero skipped**, types, build and lint.
`git diff --check` passes. Log: `%TEMP%/gnomo-t15-final-verify.log`. Only the existing
ESLint MODULE_TYPELESS_PACKAGE_JSON warning remains. The startup test caught and
fixed both undefined logger level and Redis admission-before-ready. Redis provider
now waits for its bounded initial connection, rejects startup failure safely,
reconnects after disconnection and disconnects on module shutdown. No implicit
startup queue or legacy fallback was introduced.

Owned resources retained for inspection: gnomo-t15-d21c-postgres (16550, separate
T10/T11 DBs), gnomo-t15-d21c-redis (16551), gnomo-t15-d21c-t12 (16552, AOF),
gnomo-t15-d21c-t13 (16553, AOF). No other containers were used or stopped.
No PostgreSQL server restart repeated; no skipped test hides that optional branch.
No subagents, push, PR changes/watch, merges into integration, real migrations,
production activation or issue closures. Remote checks/reviews were not queried.

Final-review implementation evidence (S1/S2 and F1–F3 separately, 182 tests with no
skips, isolated persistence and real Docker smoke) is recorded in
[the review report](final-code-review.md#implementation-resolutions--2026-11-06).
This supersedes the earlier 174-test local code verification only. Live measurement,
human acceptance and pilot remain UNPERFORMED; runtime acceptance is still gated.
