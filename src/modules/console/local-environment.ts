import { resolve } from 'node:path'
import { config } from 'dotenv'
import { CONSOLE_DEFAULTS } from './console-session'

/** Hosts that can only be this machine or its Docker Compose services. */
const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'postgres',
  'redis',
  'host.docker.internal',
])
const STORAGE_KEYS = [
  'DATABASE_URL',
  'DATABASE_URL_POOLED',
  'PILOT_MEMORY_DATABASE_URL',
  'REDIS_URL',
]

type Environment = Record<string, string | undefined>

export class LocalEnvironmentError extends Error {}

/** Refuses any database/Redis URL that is not local. Never echoes credentials. */
export function assertLocalStorage(env: Environment) {
  if (!env.REDIS_URL?.trim())
    throw new LocalEnvironmentError(
      'REDIS_URL es obligatorio (claims y recordatorios usan Redis como en producción). Usa el Redis local, p. ej. redis://:gnomo123@127.0.0.1:6379/14.',
    )
  for (const key of STORAGE_KEYS) {
    const value = env[key]?.trim()
    if (!value) continue
    let host: string
    try {
      host = new URL(value).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    } catch {
      throw new LocalEnvironmentError(`${key} no es una URL válida.`)
    }
    if (!LOCAL_HOSTS.has(host))
      throw new LocalEnvironmentError(
        `${key} apunta a un host no local (${host}). El sandbox solo usa la base y Redis locales; defínelo en .env.sandbox (vacío si no aplica, p. ej. ${key}=).`,
      )
  }
}

/**
 * Production configuration, locally: `.env.sandbox` (or SANDBOX_ENV_FILE) overrides `.env.local`,
 * which overrides `.env`; exported shell variables override all files. Afterwards the normal
 * ConfigModule validation runs unchanged, with the console transport selected.
 */
export function loadConsoleEnvironment(env: Environment = process.env, cwd = process.cwd()) {
  for (const file of [env.SANDBOX_ENV_FILE || '.env.sandbox', '.env.local', '.env'])
    config({ path: resolve(cwd, file), processEnv: env as Record<string, string>, quiet: true })
  env.GNOMO_TRANSPORT = 'console'
  env.GUILD_ID ||= CONSOLE_DEFAULTS.guildId
  env.RUNTIME_MODE ||= 'guild'
  assertLocalStorage(env)
  return env
}
