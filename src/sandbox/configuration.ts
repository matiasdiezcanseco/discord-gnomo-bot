import { readFile } from 'node:fs/promises'
import { parse } from 'dotenv'

/** Only sandbox/provider settings are accepted. Discord/runtime secrets are discarded. */
export async function sandboxEnvironment(): Promise<Record<string, string | undefined>> {
  const file = process.env.SANDBOX_ENV_FILE || '.env.sandbox'
  let privateConfig: Record<string, string> = {}
  try {
    privateConfig = parse(await readFile(file))
  } catch (error) {
    if (
      process.env.SANDBOX_ENV_FILE ||
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    )
      throw new Error(
        'Sandbox configuration file could not be read; check SANDBOX_ENV_FILE or .env.sandbox.',
      )
  }
  return Object.fromEntries(
    [
      'SANDBOX_DATABASE_URL',
      'SANDBOX_REDIS_URL',
      'OPENAI_API_KEY',
      'OPENAI_MODEL',
      'TAVILY_API_KEY',
    ].map((key) => [key, process.env[key] ?? privateConfig[key]]),
  )
}
