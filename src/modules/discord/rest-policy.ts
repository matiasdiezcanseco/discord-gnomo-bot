import type { RateLimitData, RESTOptions } from 'discord.js'

/** Longest bucket wait a request may queue for; conversation budgets still bound the total. */
export const MAX_RATE_LIMIT_WAIT_MS = 2000

/**
 * A rate-limited request was never accepted, so queueing it is safe for reads and sends alike.
 * Short per-route waits (the members bucket resets in under a second) are absorbed; global or
 * long limits fail fast so the caller's budget decides.
 */
export function rejectLongRateLimit(data: Pick<RateLimitData, 'global' | 'retryAfter'>) {
  return data.global || data.retryAfter > MAX_RATE_LIMIT_WAIT_MS
}

// Discord 5xx can mean acceptance is unknown, so never retry those; callers own retry policy.
export const DISCORD_REST: Partial<RESTOptions> = {
  retries: 0,
  timeout: 10000,
  rejectOnRateLimit: rejectLongRateLimit,
}
