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
