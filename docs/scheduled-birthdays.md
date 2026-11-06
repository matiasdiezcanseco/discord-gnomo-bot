> T15 current runtime/setup/rollout supersedes positional composition, legacy routing and Prisma setup below: see [runtime-transition.md](runtime-transition.md). Historical implementation evidence remains below.

# Scheduled birthdays (T13)

The sole birthday producer is `BirthdayCheckTask`; its old direct Discord send is
replaced for the whole configured group, independently of conversation pilot
channels. Other nonpilot reminder behavior stays unchanged. Deploy this version
to all birthday workers together, stopping/draining old daily cron executions
first. Mixed versions can still duplicate messages and are unsupported.

The configured bucket `birthdays.json` remains the source: an array of
`{ id: Discord member snowflake string, name: nonempty string <= 200 characters,
date: MM-DD }`. Invalid rows are ignored; unknown fields cannot select a guild,
channel or recipient. Duplicate rows share a durable identity; the first saved
valid name wins. February 29 is celebrated only on February 29. The destination
comes only from GUILD_ID and GNOMOS_CHANNEL_ID. There is no registration UI or
conversation capability for birthday announcements.

The scheduled event evaluates America/Lima calendar dates and saves today's
notices due at 08:00 Lima. A minute cron permits same-day recovery after startup
or source outages. Before 08:00 notices wait; no previous-day backfill is attempted.
Source failures leave existing notices retained; a successful empty array creates
nothing. Delivery revalidates the source, destination, birthday date and current
Discord member/bot permissions, including a second check immediately before send.
A missing source is a bounded transient failure; a removed/invalid row, destination
change, expired calendar date or revoked permission is terminal. Unknown network
acceptance is uncertain and never blindly retried.

The birthday origin is internal scheduling data, distinct from an authenticated
conversation invocation. Identity includes birthday kind, guild, channel, member
and full Lima calendar date. The shared ScheduledNotices Redis records, atomic
claims, leases, attempt limit, retry delays and dead/uncertain transitions are
unchanged. Allowed mentions contain only the birthday member; source names have
mention syntax neutralized. Greeting wording remains `Feliz cumpleaños NAME! 🎉🎉🎉`.

Delivery is conservative rather than exactly once: Discord response loss cannot
prove acceptance. Source/permission checks and the send are separate requests,
so changes between the final check and Discord accepting cannot be made atomic.
AOF durability requirements and retention follow `reliable-reminders.md`.
Live Discord acceptance, production persistence/failover and real latency have
not been measured by controlled tests.

## Verification and reproduction

TDD evidence: the first source/event test failed because birthday scheduling was
absent, then passed with shared Redis scheduling; the delivery revalidation test
then failed with an actual forbidden greeting after source removal, and passed
when the real Discord adapter enforced birthday authorization. Additional seam
coverage exercises two clients/workers, duplicate rows, midnight/year/08:00/leap
boundaries, invalid and unavailable sources, source injection, revoked permissions,
changed destination, transient/permanent/uncertain delivery, real Nest tasks and
conversation tool forgery. The old direct-send test now checks that missing Redis
never falls back to an unclaimed send.

Use disposable named resources only (ports below were free for this run):

```powershell
docker run --detach --name gnomo-t13-redis --publish 127.0.0.1:16432:6379 redis:7-alpine redis-server --appendonly yes --appendfsync always
docker run --detach --name gnomo-t13-restart --publish 127.0.0.1:16433:6379 redis:7-alpine redis-server --appendonly yes --appendfsync always
docker run --detach --name gnomo-t13-birthday-restart --publish 127.0.0.1:16434:6379 redis:7-alpine redis-server --appendonly yes --appendfsync always
docker run --detach --name gnomo-t13-postgres --env POSTGRES_PASSWORD=test-only --env POSTGRES_USER=gnomo --env POSTGRES_DB=gnomo_t13 --publish 127.0.0.1:16431:5432 pgvector/pgvector:pg17
docker exec gnomo-t13-postgres psql -U gnomo -d gnomo_t13 -c 'CREATE DATABASE gnomo_t11;'
$env:T02_REDIS_URL='redis://127.0.0.1:16432'
$env:T12_REDIS_RESTART_URL='redis://127.0.0.1:16433'
$env:T12_REDIS_CONTAINER='gnomo-t13-restart'
$env:T13_REDIS_RESTART_URL='redis://127.0.0.1:16434'
$env:T13_REDIS_CONTAINER='gnomo-t13-birthday-restart'
$env:T10_DATABASE_URL='postgresql://gnomo:test-only@127.0.0.1:16431/gnomo_t13'
$env:T11_DATABASE_URL='postgresql://gnomo:test-only@127.0.0.1:16431/gnomo_t11'
npm ci --ignore-scripts
npm run db:generate
npm run verify
docker rm --force gnomo-t13-redis gnomo-t13-restart gnomo-t13-birthday-restart gnomo-t13-postgres
```

The birthday AOF test uses a different Redis from the inherited T12 restart test;
concurrent test files must not restart one another's server. Missing environment
variables explicitly skip these tests. The T10 optional PostgreSQL restart branch
is not configured: this run proves SQL persistence across client recreation and
real Redis AOF restart, not PostgreSQL server restart. T11 uses a separate database
on the owned PostgreSQL container because its migration fixture drops tables.

Final validation after merging local integration commit `5962a7e`: `npm run verify`
passed 147 tests, zero failed, zero skipped, followed by typecheck, Nest build and
lint. Eight birthday tests passed. The optional T10 server-restart branch remains
unconfigured as described above. Restart tests can log a temporary ECONNREFUSED
while Redis comes back; clients reconnect and assertions pass. ESLint reports the
existing package module-type warning. No production services, deployment, push,
PR creation or issue closure were performed.
