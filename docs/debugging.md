# Debugging production

Logs are JSON lines on stdout in production (`NODE_ENV=production`), pino-pretty otherwise.
Secrets are redacted everywhere (`src/diagnostics.ts`): URL credentials, `Bearer`, `sk-…`,
`tvly-…`, Discord tokens, `?key=` parameters. Message text is **not** logged unless
`LOG_CONTENT=true`.

```powershell
fly logs                                   # live
fly logs | Select-String '"level":(40|50|60)'   # warnings and errors only
fly logs | Select-String '<invocationId>'  # one invocation end to end
```

The `invocationId` is the Discord message ID of the request (right click → Copy message ID).

## Startup

| Line                                      | Answers                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Runtime configuration`                   | Mode, model, timeouts, which features are configured and `disabled` (with the missing variable)     |
| `Discord client ready`                    | Bot tag/id, guild count, `configuredGuildPresent` (false = bot not in `GUILD_ID`, error logged too) |
| `Not logging into Discord`                | Paused or no `BOT_TOKEN`                                                                            |
| `Discord login failed` / `Startup failed` | Redacted cause (bad token, migrations, Redis unreachable with its error code)                       |

## One invocation (`module: conversation`, message `conversation <event>`)

```text
received        guildId, channelId, requesterId, contentLength, attachments (+content with LOG_CONTENT)
authorization   allowed | denied (warn)
model_started   tools offered
model_finished  durationMs, toolCalls, model.{finishReason, inputTokens, outputTokens, reasoningTokens, responseId, warnings}
                status "empty" (warn) = provider returned no text and no calls
tool_started    tool
tool_rejected   (warn) never ran: unknown tool, denied, unavailable, invalid input (field: issue), limit
tool_outcome    (warn) ran but answered a soft failure, e.g. memory "unavailable: …", "denied: …"
tool_failed     (error) threw: error.{name, message, code, status, response, cause}
tool_finished   status, durationMs
stopped         (error) the turn aborted: timeout or error with the provider error (e.g. 401, 429)
synthesis_*     fallback phrasing turn
visible_send    one Discord message sent
delivery        (warn/error) denied or uncertain, with the send error
delivered       parts (+reply with LOG_CONTENT)
```

Messages that tag the bot but are not handled log `Tagged message ignored` (`module: receiver`)
with the `reason`: another guild, missing `GUILD_ID`, runtime policy (`RUNTIME_MODE` /
`RUNTIME_CHANNEL_IDS`) or a bot author. `Invocation failed` carries the error.

## Handled errors (`module: diagnostics`, message `handled error in <scope>`)

Errors the bot deliberately survives, with their cause:

| Scope                                                                                                       | What failed                                                      |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `memory.connect`, `memory.query`, `memory.embedding`                                                        | PostgreSQL pool/query, embeddings (memory replies "unavailable") |
| `postgres.pool`                                                                                             | Idle pool connection                                             |
| `redis.connection`                                                                                          | Redis errors (at most one per 30 s)                              |
| `discord.members.list`, `discord.members.detail`, `discord.voice`, `discord.history.page`, `discord.typing` | Discord REST/gateway reads                                       |
| `tavily.search`                                                                                             | Search/news provider                                             |
| `images.decode`                                                                                             | Attached image verification                                      |
| `notices.authorize`, `notices.revalidate`, `notices.send`, `notices.delivery`                               | Reminder/birthday delivery (with `noticeId`, `kind`, `next`)     |

Discord connection health (`module: discord`): `Discord gateway disconnected` (close code),
`reconnecting`, `resumed`, `Discord session invalidated`, `Guild unavailable`,
`Discord REST rate limited` (route, retry after). Unhandled rejections and uncaught exceptions
log under `module: process`. AI SDK warnings log under `module: ai-sdk`.

## Reproducing locally

Run the same runtime in the [console sandbox](sandbox.md) with `LOG_CONTENT=true` and follow
`sandbox.log`. Set `NODE_ENV=production` to get exactly the production JSON lines.
