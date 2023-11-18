declare global {
  namespace NodeJS {
    interface ProcessEnv {
      BOT_TOKEN: string
      BUCKET_URL: string
      GUILD_ID: string
      GNOMOS_CHANNEL_ID: string
      TEST_CHANNEL_ID: string
    }
  }
}
export {}
