# Reliable own reminders (T12)

The pilot accepts a current authenticated request such as `recuérdame en 2 minutos
tomar agua`, `recuérdame mañana a las 08:00 tomar agua`, or `recuérdame 2026-11-06
a las 08:00 tomar agua`. Dates use America/Lima; relative times start at the
original invocation timestamp. Unsupported or ambiguous expressions (including
`mañana a las 8` without a 24-hour time) ask for clarification without saving.
This conservative grammar avoids a second model parsing loop. Other phrasings
need the explicit form shown in the clarification. One invocation creates at most
one own reminder. No DM, arbitrary destination, other recipient, cancellation,
admin tooling or birthday creation is exposed through conversation.

## Public contracts and composition

`pilotCatalog(collection?, members?, history?, search?, live?, web?, memory?, notices?)`
preserves T02/T04/T05/T06/T07, T08 and T10 positional arguments. `composePilot` supplies
the real Redis-backed notices store as argument eight. `reminder_create` declares
`reminders.own`, a channel write with a strict empty argument schema. Code parses
only `ExecutionContext.invocation`, never model-proposed text, times or identities.
The real composition authorizes this write only for a current anchored own request,
in the configured guild and pilot channel, after fresh Discord permission checks.
History and web data cannot initiate writes independently. The direct route uses
the existing executor and shared 12-second/eight-call budget, then the original
15-second reply deadline. Redis timeouts produce an explicit uncertain response;
late completion is possible and must not be treated as failure to save.

`ScheduledNotices.save(origin, text, due)` atomically inserts a record and due index,
or returns the existing record for the authenticated guild/channel/message identity.
It deliberately ignores model call IDs for deduplication. `get(id)` exposes state
and diagnostics; `dispatch(now, ScheduledDelivery)` is the scheduled-notice contract
for T13 reuse. `ScheduledDelivery.authorize` and `send` are controlled external
ports. The Discord adapter fetches fresh guild, channel, bot and requester, checks
view/history/send permissions, thread state and private-thread membership, and
restricts allowed mentions to the requester. T13 must supply its own approved
birthday origin/recipient policy and presentation; this ticket does not grant one
through conversation tools. The current presentation says “¡Recordatorio!”.

`ReliableNoticesTask` is a Nest provider in `ScheduleModule`, with an actual
ten-second cron and ready-client guard. T13 replaces the sole birthday producer with shared notice scheduling; see
`scheduled-birthdays.md` for its trusted origin, source and destination policy.
No detached process, startup migration, or alternate Discord listener is added.

## Redis schema and failure semantics

Namespace `gnomo:notices:v1`: `:records` is a hash from SHA-256 ID to JSON;
`:due` is a sorted set of IDs scored by due/retry/lease expiry milliseconds.
Records contain `id`, authenticated `origin`, `text`, `due`, `state`, `attempts`,
lease `token` and optional `diagnostic`. Versioning is in the namespace. Records,
including terminal states and idempotency identities, have no automatic TTL.
Operators must plan retention separately; contents are persisted reminder data.

Atomic Lua transitions implement:

* pending → leased (exclusive random token, 30 seconds; attempt count increments).
* expired leased → leased with a new token; stale workers cannot mark sending.
* leased → sending before contacting Discord.
* sending → sent after a successful response.
* proven transient rejection → pending, at 60 then 120 seconds; three attempts total.
* permanent rejection, revoked permission, or exhausted attempts → dead with reason.
* unclassified errors, timeout, lost response, or expired sending lease → uncertain.

There is no blind resend from uncertain and no exactly-once promise for Discord.
Redis failure after a send leaves the sending marker for conservative recovery.
Discord REST automatic 5xx retries and rate-limit queue retries are disabled in
the runtime client. Only a proven rejection may be classified transient. Unknown
authorization lookup failures before sending are safe for bounded retry; explicit
missing permission is dead. Dead and uncertain records remain inspectable with `get(id)` or HGETALL;
there is intentionally no automatic manual-replay command in this ticket.

Persistence across Redis server restart requires a persistent Redis data volume
and AOF with `appendfsync always` (or equivalent durability provision). A successful
Redis command alone does not prove an arbitrary production Redis configuration
has flushed disk. Tests exercise actual isolated Redis 7 AOF restart; they do not
prove disk-loss, replication/failover or production storage durability. No SQL
storage changes or PostgreSQL persistence guarantees are introduced here.

## Explicit legacy transition

Deploy the coordinated version to **all** reminder workers before enabling pilot
channels; stop/drain old-version cron executions before changing the channel list.
Configuration must agree across workers. Mixed old versions cannot be fenced by
this new code and are unsupported during cutover.

The legacy cron skips every configured pilot channel **before fetching/sending or
deleting** any pending reminder. Nonpilot legacy scheduling and creation remain
operative until T15. Pending pilot legacy records remain intact, even before the
explicit transfer. They are paused until transferred, never silently dropped.

After the coordinated rollout, run with the intended environment configuration:

```powershell
npx tsx --tsconfig tsconfig.nest.json scripts/transfer-pilot-reminders.ts --apply
```

This operation requires REDIS_URL, GUILD_ID, BOT_TOKEN and
CONVERSATION_PILOT_CHANNEL_IDS. It verifies each legacy origin channel against the
configured guild through Discord. It saves a stable `legacy:<id>` identity before
removing the old due-index entry; the original `reminder:<id>` payload is retained.
It explicitly scans legacy payload keys as well, recovering orphaned payloads from
the old non-atomic SET/ZADD creation path. This scan runs only on operator request.
A crash between save/index removal is safe because legacy pilot dispatch is
excluded. Repeating the operation is idempotent. Malformed, oversized, foreign-guild,
inaccessible or nonpilot entries stay pending and are reported retained. Do not
remove a channel from the pilot configuration halfway through transfer. New
scheduled notices continue using their own namespace even if conversation routing
later rolls back. Restore legacy indexes only with both dispatch paths stopped and
an explicit reviewed reconciliation; never restore already delivered records.

## Reproduction

No model, web, Discord or production credentials are used by tests. External
model/Discord boundaries are controlled; Redis storage, Lua, restart and client
recreation are real. Tests start at invocation → reply/effects; scheduling states
are also observed through the public scheduled delivery contract.

```powershell
npm ci --ignore-scripts
npm run db:generate
docker run --detach --name gnomo-t12-redis --publish 127.0.0.1:16392:6379 redis:7-alpine redis-server --appendonly yes --appendfsync always
docker run --detach --name gnomo-t12-restart --publish 127.0.0.1:16393:6379 redis:7-alpine redis-server --appendonly yes --appendfsync always
$env:T02_REDIS_URL='redis://127.0.0.1:16392'
$env:T12_REDIS_RESTART_URL='redis://127.0.0.1:16393'
$env:T12_REDIS_CONTAINER='gnomo-t12-restart'
docker run --detach --name gnomo-t12-postgres --env POSTGRES_PASSWORD=test-only --env POSTGRES_USER=gnomo --env POSTGRES_DB=gnomo_t12 --publish 127.0.0.1:16412:5432 pgvector/pgvector:pg17
$env:T10_DATABASE_URL='postgresql://gnomo:test-only@127.0.0.1:16412/gnomo_t12'
npm run verify
docker rm --force gnomo-t12-redis gnomo-t12-restart gnomo-t12-postgres
```

Only name an isolated disposable test container in T12_REDIS_CONTAINER: the test
actually restarts it. Missing Redis variables explicitly skip persistence tests.
The main test Redis is separate from the server-restart test. Production Redis
must never be used for these tests (CLIENT PAUSE is used to exercise write timeout).
Real Discord acceptance, model robustness and production latency remain unmeasured.
The pre-existing Redis retention/reconnect test from 42e3193 is preserved unchanged.
