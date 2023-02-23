declare global {
  namespace NodeJS {
    interface ProcessEnv {
      BOT_TOKEN: string
      BUCKET_URL: string
      GUILD_ID: string
    }
  }
}
export {}
