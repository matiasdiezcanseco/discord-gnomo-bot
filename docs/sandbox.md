# Sandbox conversations

Use the real conversation harness, tool executor, schemas, policy allowlist,
deadlines, memory operations and notice engine without connecting to Discord.
The sandbox has its own composition root; it never starts Nest/AppModule,
constructs a Discord Client, logs into the Gateway, or calls Discord REST.
All replies, mentions and scheduled messages stay in the terminal/JSON output.
There are no background jobs. The ordinary bot may remain paused.

## Start locally

With local PostgreSQL and Redis running:

```powershell
npm run sandbox:setup
npm run sandbox
```

Setup explicitly creates the **gnomo_sandbox** database and applies the Drizzle
memory migrations there. It never imports production memories or changes the runtime's
`gnomo` database. Storage URLs must point to local hosts, a database named
`gnomo_sandbox` (or `gnomo_sandbox_*`) and Redis database **14**. Runtime variables
such as `PILOT_MEMORY_DATABASE_URL`, `REDIS_URL`, `BOT_TOKEN`, `GUILD_ID` and
`RUNTIME_MODE` are ignored. The local pilot uses Redis 15 and the previous runtime
uses Redis 0; sandbox keys are additionally prefixed `gnomo:sandbox:<session>`.
Local passwords are the development-only defaults from Compose.

Each input line is an invocation. A Discord mention is unnecessary. Try:

```text
dame una frase
quién está conectado
qué usuarios están en voz
consulta el historial
guarda recuerdo [clave=juego]: me gusta Portal
busca recuerdos: Portal
recuérdame en 1 minuto tomar agua
/tick 61
/channel juegos
busca recuerdos: Portal
/as ana
menciona a Bruno
/quit
```

Fixture users are Tester (owner), Ana and Bruno; channels are general and juegos.
Tester/Ana are visibly online; Bruno's presence is unknown. These are fictional
identities, not the real server roster. The history/member schema source labels
retain the production contracts, while the CLI and fixture notes identify them
as simulated data. Presence and voice remain separate capabilities.

Commands:

| Input                                 | Effect                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `/as tester`, `/as ana`, `/as bruno`  | Change the simulated requester                                            |
| `/channel general`, `/channel juegos` | Change the isolated channel scope                                         |
| `/permit no`, `/permit yes`           | Deny/restore local permissions, including delivery                        |
| `/image C:\path\photo.png`            | Attach a local image to the next invocation                               |
| `/birthdays`                          | Queue today's fictional Ana birthday through the shared producer          |
| `/tick 60`                            | Advance the local notice clock by 60 seconds and dispatch to local output |
| `/help`, `/quit`                      | Help/exit                                                                 |

Birthdays become due at 08:00 America/Lima. `/tick` advances this process's simulated
notice time; it does not sleep or change the computer clock. Time offsets and
channel history reset when restarting the CLI. Memories, claims and notice states
persist across process restarts. Scheduled delivery substitutes local authorization
and an outbox for Discord; real server permission/source revalidation remains
covered by the adapter tests and later transport acceptance.

## One-shot and automated use

PowerShell's `npm.ps1` wrapper on this machine drops the argument separator; use
`npm.cmd` when passing flags. On macOS/Linux use `npm` with the same arguments.

```powershell
npm.cmd run sandbox -- --ask "quién está conectado"
npm.cmd run sandbox -- --session exploratory
@('dame una frase', 'consulta el historial') | npm.cmd run sandbox -- --json
npm.cmd run sandbox -- --memoryless --ask "dame una frase"
```

`--json` emits one JSON event per line (ready, response, scheduled-delivery, error,
etc.). Response data contains the normalized invocation, reply parts and harness
traces. For pure JSON without npm's script banner, call:

```powershell
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.nest.json src/sandbox/cli.ts --json
```

Reuse a session name to revisit its memories/notices; choose another to isolate
an experiment. `--memoryless` needs no services and disables durable memory and
reminders explicitly; it does not fake successful writes. Nothing clears Redis
or imports old records. There is no automatic transcript file; save JSON only
where you intend to retain its content.

## Real model and public web, still disconnected from Discord

Default mode is a deterministic **fixture model** with fixture pages/search and
collection data. It drives tool flows for repeatable tests; its output is not
evidence of personality, reasoning quality or live news accuracy.

For real conversation, copy `.env.sandbox-example` to ignored `.env.sandbox`,
provide the OpenAI key and explicit model privately, then:

```powershell
npm.cmd run sandbox -- --live-model
npm.cmd run sandbox -- --live-model --live-web
npm.cmd run sandbox -- --live-model --image C:\path\photo.png --ask "describe esta imagen"
```

The CLI automatically reads `.env.sandbox` in the current directory. To select
another file in PowerShell, use `$env:SANDBOX_ENV_FILE='C:\path\sandbox.env'`.
Exported process variables take precedence over file values. Windows user/system
environment changes require a new terminal; a `.env.sandbox` edit is read on the
next run. Only the five sandbox/provider settings in the example are accepted;
`.env` and `.env.local` are never auto-loaded. The real model uses
the production AI SDK adapter/persona and can consume verified local image bytes.
Real-model mode sends requests to OpenAI and uses the configured API account;
it still has no Discord token or send transport. No silent model substitution.

Without `--live-web`, all web/search results remain fixtures even with the real
model. `--live-web` enables the bounded public reader and Tavily search/news when
`TAVILY_API_KEY` is supplied. Collections/members/presence/history remain local
fixtures. The sandbox reader blocks Discord domains/CDNs/invites and literal IP
destinations, checking before DNS and each connection, including redirects. The
model endpoint is fixed to api.openai.com and does not follow redirects. Tavily
uses its fixed endpoint without redirects. Form submissions, authenticated web
actions and arbitrary outbound messaging are absent from the tool allowlist.

## Docker alternative

The same image also contains the compiled sandbox entry points. No sandbox port
is published; input/output use the attached terminal. After starting local services:

```powershell
docker compose --profile sandbox build sandbox
docker compose --profile sandbox run --rm --no-deps sandbox node dist/sandbox/setup.js
docker compose --profile sandbox run --rm --no-deps sandbox
```

This profile supplies internal `postgres`/`redis` hostnames and no runtime secret
file. Default fixture mode works without provider credentials. For host images
and real-provider testing, the host CLI above is the simplest path.

## Verification and limits

Eight sandbox regressions cover configuration loading, invocation/reply/context scoping, CLI isolation
from Discord configuration, duplicate suppression, blocked Discord redirects,
persistent memory/reminders/birthdays and local-only delivery, verified images
and refusal of runtime/remote storage. Run persistent cases with explicit isolated
`SANDBOX_TEST_DATABASE_URL` / `SANDBOX_TEST_REDIS_URL`; missing URLs report a skip.
The full integration run passed **189/189, zero skipped**, types/build/lint, with
isolated PostgreSQL/pgvector databases and separate real Redis AOF restarts for
T12/T13. Final log: `plans/sandbox-verify-final.log`. The four temporary regression
containers were removed; the local PostgreSQL/Redis services are retained.

The compiled Docker sandbox also passed setup, phrase/presence queries and
reminder creation/local dispatch, with no Discord credentials. Image build log:
`plans/sandbox-docker-final.log`. Manual host CLI testing additionally confirmed
channel-isolated recall and permission denial. These are fixture results, not
real-provider latency measurements.

The sandbox can replace Discord for iterative conversation/tool testing. It
does not establish real Gateway/REST behavior, server intents/permissions, actual
Discord delivery timing, Supabase connectivity, or human acceptance. Real OpenAI/
Tavily tests require private keys and were not run in this change. Local Redis AOF
is still disabled; isolated AOF tests do not certify that local instance's crash
durability. No production data, credentials or server messages are used here.
