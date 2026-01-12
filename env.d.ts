declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // Discord
      BOT_TOKEN: string
      GUILD_ID: string
      GNOMOS_CHANNEL_ID: string
      TEST_CHANNEL_ID?: string

      // External Services
      BUCKET_URL: string
      OPENAI_API_KEY: string
      OPENAI_MODEL?: string
      TAVILY_API_KEY?: string

      // Redis (optional)
      REDIS_URL?: string
      CONVERSATION_TTL?: string
      MAX_CONVERSATION_MESSAGES?: string

      // Runtime
      NODE_ENV?: 'development' | 'production' | 'test'
      LOG_LEVEL?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
    }
  }
}
export {}
