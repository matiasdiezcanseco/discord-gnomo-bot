import { readFile } from 'node:fs/promises'
import { parse } from 'dotenv'

/** Only sandbox/provider settings are accepted. Discord/runtime secrets are discarded. */
export async function sandboxEnvironment(): Promise<Record<string, string | undefined>> {
  const file = process.env.SANDBOX_ENV_FILE
  const privateConfig = file ? parse(await readFile(file)) : {}
  return Object.fromEntries(
    [
      'SANDBOX_DATABASE_URL',
      'SANDBOX_REDIS_URL',
      'OPENAI_API_KEY',
      'OPENAI_MODEL',
      'TAVILY_API_KEY',
    ].map((key) => [key, privateConfig[key] ?? process.env[key]]),
  )
}
