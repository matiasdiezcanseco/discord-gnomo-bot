## discord-gnomo-bot

Discord bot with gnomo phrases and images, powered by AI with web search capabilities.

### Features

- **AI Assistant**: Natural language conversation in Spanish
- **Web Search**: Real-time information from the internet using Tavily AI
- **Random Phrases**: Get gnomo phrases and quotes
- **Random Images**: Get gnomo pictures
- **Conversation History**: Maintains context using Redis

### Commands

```
-g pic: Sends a gnomo picture
-g frase: Sends a gnomo phrase
```

You can also chat naturally with the bot. It will understand requests like:

- "dame una frase" (get a phrase)
- "muéstrame una foto" (show me a picture)
- "¿cuál es el clima en Lima?" (web search for current information)
- Any question requiring real-time data

### Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env-example` to `.env` and fill in your credentials:

```bash
cp .env-example .env
```

Required environment variables:

- `BOT_TOKEN`: Your Discord bot token
- `OPENAI_API_KEY`: OpenAI API key for AI responses
- `TAVILY_API_KEY`: Tavily API key for web search (get one at https://tavily.com)
- `UPSTASH_REDIS_REST_URL`: Upstash Redis URL for conversation history
- `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis token

3. Run the bot:

```bash
npm run dev
```

### Presence and voice in the new conversation pilot (T06)

The pilot registers separate read tools `presence_list` and `voice_list`. Configure
`GUILD_ID`, `CONVERSATION_PILOT_CHANNEL_IDS`, model credentials and Redis as described
in [the harness setup](docs/tickets/gnomo-refactor/02-testing.md). An empty pilot
channel list keeps the existing route selected.

Before starting the bot, enable **Presence Intent**, **Server Members Intent** and
**Message Content Intent** on the application's Bot page in the Discord Developer
Portal. The client requests `Guilds`, `GuildMessages`, `MessageContent`, `GuildMembers`,
`GuildPresences` and `GuildVoiceStates`. Unauthorized privileged intents can prevent
Gateway login (4014); enabling an intent in code alone does not enable it in the portal.
See [Discord's intent setup](https://docs.discord.com/developers/events/gateway#enabling-privileged-intents).
Do not grant Administrator. Retain the pilot's existing View Channel, Read Message
History and Send Messages permissions (Send Messages in Threads where applicable).
Voice listing needs visibility of the voice channel for both requester and bot;
it does not join a call and needs no Connect, Speak or administrative permission.

Presence is a Gateway cache observation, not a live REST status request. Online,
idle and dnd count as connected; offline means **appears disconnected**. Invisible
cannot be distinguished from offline. Missing entries, missing intents and incomplete
initialization remain unknown. Voice and recent messages never imply online presence.
Both tools include `queriedAt` (cache query time, not event time), coverage and member
page cursors. Neither claims a complete Gateway census. Empty voice results do not
prove nobody is in a call. Hidden voice channels and their participants are excluded.

Controlled-server validation is **pending**, since this implementation was tested
without Discord/model credentials. With consenting test accounts, the owner should:

1. Confirm Gateway login with the portal intents enabled, then invoke the bot in a
   configured pilot channel and change the test account through online, idle and dnd.
2. Test offline and invisible: report only apparent disconnection if Discord supplies
   an offline entry, otherwise unknown; never identify an invisible account.
3. Query during reconnect/initialization and inspect partial/unknown coverage and
   `queriedAt`; a missing cached member must not become disconnected.
4. Move test accounts between a visible voice channel and one hidden to the requester;
   query from that requester, revoke visibility and repeat. No hidden channel name,
   ID or participant may appear. Also test bot visibility revocation.
5. Check missing intent behavior with a separate test client. Keep observations local;
   do not log other members' identities, statuses or channel payloads. Record only
   aggregate pass/fail and timing. Real latency targets remain unmeasured.

### Deployment

Explicit pilot memories use separate PostgreSQL/pgvector storage, opt-in embeddings
and a trusted `MEMORY_OWNER_ID`. Setup, request syntax, deletion guarantees and
isolated tests: [T10 storage contract](docs/tickets/gnomo-refactor/10-storage-contract.md).
No schema setup or legacy data migration runs automatically at startup.

Deploy to Fly.io:

```bash
npm run deploy
```
