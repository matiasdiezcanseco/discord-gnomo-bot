declare global {
  namespace NodeJS {
    interface ProcessEnv {
      BOT_TOKEN: string
      BUCKET_URL: string
      GUILD_ID: string
      GNOMOS_CHANNEL_ID: string
      TEST_CHANNEL_ID: string
      OPENAI_API_KEY: string
      OPENAI_MODEL: string
      UPSTASH_REDIS_REST_URL: string
      UPSTASH_REDIS_REST_TOKEN: string
      CONVERSATION_TTL: string
      MAX_CONVERSATION_MESSAGES: string
      TAVILY_API_KEY: string
    }
  }
}
export {}
