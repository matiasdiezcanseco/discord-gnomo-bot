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
pnpm install
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
pnpm dev
```

### Deployment

Deploy to Fly.io:
```bash
pnpm deploy
```
