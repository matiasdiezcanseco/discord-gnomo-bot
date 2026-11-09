# Console sandbox

The sandbox is the **production runtime with the terminal as transport**. It boots the
same Nest application as `src/main.ts`, with `DiscordModule` swapped for `ConsoleModule`
and nothing else changed:

| Same as production                                                                       | Different                                           |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `ConfigModule` validation, `RUNTIME_MODE` / `RUNTIME_CHANNEL_IDS` / `GUILD_ID` policy    | Messages come from stdin, replies go to stdout      |
| Startup Drizzle migrations (`DatabaseModule`), memory pool, embeddings                   | No Discord login, no `BOT_TOKEN`                    |
| Redis connection, claims/dedup, reminders, birthday producer and 10 s notice dispatcher  | Database/Redis URLs must be local (enforced)        |
| OpenAI model, persona, budgets/timeouts, tool catalog, allowlist, Tavily, web reader     | Channel history = this session's console transcript |
| Bucket phrases/photos/birthdays, image verification, trace logs (`module: conversation`) | Members/presence = console identities; voice empty  |

The shared piece is `composeRuntimeConversation` (`src/conversation/composition.ts`).
Discord and the console each provide only a `ConversationPlatform` (channel access,
members, presence/voice, history) and a `Transport` (readiness, scheduled delivery).
Discord channel-permission checks do not apply in the console; the deployment policy
and tool allowlist do. Members, history and presence tools get the same schemas, limits
and model-facing notes as in Discord.

## Start

```powershell
docker compose up -d postgres redis
copy .env.sandbox-example .env.sandbox   # once; then edit it
npm run sandbox
```

`npm run sandbox` compiles with `nest build` (as production) and runs `dist/console.js`.
`npm run sandbox:watch` restarts on source changes (the console transcript resets).

### Configuration

Loading order (first wins): exported shell variables → `.env.sandbox` (or
`SANDBOX_ENV_FILE`) → `.env.local` → `.env`. So you only override in `.env.sandbox`
what must differ from production; API keys, `BUCKET_URL`, `MEMORY_OWNER_ID`,
`OPENAI_MODEL`, etc. can stay in `.env`.

- `DATABASE_URL`, `DATABASE_URL_POOLED`, `PILOT_MEMORY_DATABASE_URL` and `REDIS_URL` must
  point to `localhost`, `127.0.0.1`, `::1`, `postgres`, `redis` or `host.docker.internal`.
  Anything else stops startup with the offending variable name. If `.env` holds production
  URLs, set them empty in `.env.sandbox` (e.g. `DATABASE_URL_POOLED=`).
- `REDIS_URL` is required (as in production). The example uses logical DB **14** so
  console reminders/claims do not mix with the local Discord pilot (DB 15).
- `RUNTIME_MODE` defaults to `guild` when unset anywhere. With `pilot`, the console
  channel must be in `RUNTIME_CHANNEL_IDS`; with `paused`, messages are ignored and
  the console says why — exactly what production would do.
- `GUILD_ID` defaults to a local ID when unset. Use the real one if you want birthdays
  from the bucket to be scheduled into the console (`GNOMOS_CHANNEL_ID` too).

Optional console identity (IDs are 17–20 digits, as Discord snowflakes):

| Variable               | Default                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `SANDBOX_USER_ID`      | `MEMORY_OWNER_ID`, so owner-only memory works as for the owner |
| `SANDBOX_USERNAME`     | `console`                                                      |
| `SANDBOX_CHANNEL_ID`   | first pilot channel, else `GNOMOS_CHANNEL_ID`, else local ID   |
| `SANDBOX_BOT_USERNAME` | `Gnomo`                                                        |
| `SANDBOX_MEMBERS`      | `id:name,id:name` extra members for lists and `@mentions`      |

## Use

Every line is a message that mentions the bot in the current channel (stored as
`<@bot> text`, as Discord history would show it). Replies and scheduled notices
(reminders, birthdays) print as they are delivered.

| Command                     | Effect                                                                |
| --------------------------- | --------------------------------------------------------------------- |
| `/say <text>`               | Post without mentioning the bot (context/history only, no reply)      |
| `/image <path>`             | Attach a local png/jpg/webp to the next message (verified as in prod) |
| `/as <id> [name]`           | Switch the requester                                                  |
| `/channel <id>`             | Switch channel; each channel has its own transcript                   |
| `/history`, `/reset`        | Show / clear the local transcript (database and Redis untouched)      |
| `/whoami`, `/help`, `/quit` |                                                                       |

Start a message with `//` to send a literal leading `/`.

Logs never share the terminal with the chat: they go to `sandbox.log` (git-ignored;
`SANDBOX_LOG_FILE` picks another path, `SANDBOX_LOG_FILE=stdout` restores inline logs).
Follow them in a second terminal; the console prints the exact command at startup:

```powershell
Get-Content sandbox.log -Wait -Tail 50
```

`LOG_LEVEL=info` writes the harness traces (`received`, `model_started`, tool calls,
`model_finished` — `status: "empty"` when the provider returned nothing — `stopped`,
`delivered`…) with the same fields as production. `NODE_ENV=production` writes JSON,
otherwise pino-pretty. AI SDK warnings are routed to the same log (`module: ai-sdk`).
Unlike production, an exception thrown out of the conversation is printed in the
terminal with its stack.

No HTTP server is started (`app.init()` without `listen`), so it can run next to a
local bot. The transcript lives in memory; memories, claims and reminders persist in
the local PostgreSQL/Redis.

## Docker

```powershell
docker compose --profile sandbox build sandbox
docker compose --profile sandbox run --rm sandbox
```

The service reads `.env` then `.env.sandbox` and forces the Compose `postgres`/`redis`
URLs. `/image` paths refer to the container filesystem.

## Tests

`test/console.test.ts` covers the local-only guard, environment loading and the history
contract. `test/runtime-startup.test.ts` boots the compiled `ConsoleAppModule` with
controlled web access and checks one terminal reply, the two cron jobs and no Discord
login (needs `T02_REDIS_URL`).
