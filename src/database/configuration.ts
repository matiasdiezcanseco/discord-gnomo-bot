import type { PoolConfig } from 'pg'

export const databaseVariables = [
  'DATABASE_URL',
  'DATABASE_URL_POOLED',
  'PILOT_MEMORY_DATABASE_URL',
] as const

// pg supports this option at runtime; its installed community types omit it.
type DatabasePoolConfig = PoolConfig & { enableChannelBinding: boolean }

/** One selection policy for runtime and operator paths. No URL/credentials in errors. */
export function databasePoolConfig(
  env: Record<string, string | undefined>,
  purpose: 'runtime' | 'migration',
): DatabasePoolConfig | undefined {
  const direct = env.DATABASE_URL?.trim()
  const legacy = env.PILOT_MEMORY_DATABASE_URL?.trim()
  const pooled = env.DATABASE_URL_POOLED?.trim()
  const selected =
    purpose === 'runtime' ? pooled || direct || legacy : direct || (!pooled ? legacy : undefined)
  if (!selected) {
    if (purpose === 'migration' && pooled)
      throw new Error('DATABASE_URL must provide a direct PostgreSQL connection for migrations')
    return undefined
  }
  let url: URL
  try {
    url = new URL(selected)
  } catch {
    throw new Error('Invalid PostgreSQL database URL')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Invalid PostgreSQL database URL')
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const neon = host.endsWith('.neon.tech')
  if (purpose === 'migration' && neon && host.includes('-pooler.'))
    throw new Error('DATABASE_URL must provide a direct Neon connection for migrations')
  if (neon) {
    if (
      ['disable', 'allow', 'prefer', 'no-verify'].includes(url.searchParams.get('sslmode') ?? '') ||
      ['0', 'false'].includes(url.searchParams.get('ssl') ?? '')
    )
      throw new Error('Neon requires verified TLS')
    url.searchParams.set('sslmode', 'verify-full')
  }
  return {
    connectionString: neon ? url.href : selected,
    enableChannelBinding:
      url.searchParams.get('channel_binding') === 'require' ||
      url.searchParams.get('channel_binding') === 'prefer',
    max: purpose === 'runtime' ? 4 : 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    // Do not send statement_timeout as a startup parameter through transaction poolers.
    // Runtime queries set their timeout transaction-locally before doing any memory work.
  }
}
