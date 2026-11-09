/**
 * Production diagnostics without leaking secrets. Errors that the runtime deliberately swallows
 * (to keep chatting, retry later or fail closed) are reported here so logs still say *why*.
 */

export interface ErrorSummary {
  name: string
  message: string
  /** Node/pg/axios error code, e.g. ECONNREFUSED, 28P01, ERR_BAD_RESPONSE. */
  code?: string
  /** HTTP status from AI SDK, axios, Discord REST or fetch wrappers. */
  status?: number
  /** Truncated provider response body (e.g. OpenAI's JSON error). */
  response?: string
  cause?: ErrorSummary
}

const SECRETS: [RegExp, string][] = [
  // Credentials inside URLs: scheme://user:password@host
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/@]*@/gi, '$1***:***@'],
  [/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer ***'],
  [/\bBot\s+[\w.-]{20,}/g, 'Bot ***'],
  [/\bsk-[\w-]{8,}/g, 'sk-***'],
  [/\btvly-[\w-]{8,}/g, 'tvly-***'],
  // Discord bot token shape: base64 id . timestamp . hmac
  [/\b[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,40}\b/g, '***discord-token***'],
  [/([?&](?:api[_-]?key|key|token|password|secret)=)[^&\s]+/gi, '$1***'],
]

export function redact(text: string, max = 500): string {
  let value = text
  for (const [pattern, replacement] of SECRETS) value = value.replace(pattern, replacement)
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function field(error: object, key: string): unknown {
  return key in error ? (error as Record<string, unknown>)[key] : undefined
}

export function describeError(error: unknown, depth = 0): ErrorSummary {
  if (!(error instanceof Error)) {
    return { name: typeof error, message: redact(String(error)) }
  }
  const summary: ErrorSummary = { name: error.name, message: redact(error.message) }
  const code = field(error, 'code')
  if (typeof code === 'string' || typeof code === 'number') summary.code = String(code)
  const response = field(error, 'response') as { status?: unknown } | undefined
  const status =
    field(error, 'statusCode') ??
    field(error, 'status') ??
    field(error, 'httpStatus') ??
    response?.status
  if (typeof status === 'number') summary.status = status
  const body = field(error, 'responseBody')
  if (typeof body === 'string' && body) summary.response = redact(body, 300)
  if (error.cause !== undefined && depth < 2) summary.cause = describeError(error.cause, depth + 1)
  return summary
}

type Sink = (scope: string, error: ErrorSummary, context?: Record<string, unknown>) => void
let sink: Sink = () => undefined

/** Registered once by the logger at startup; tests and scripts keep the silent default. */
export function setDiagnosticsSink(next: Sink) {
  sink = next
}

/** For errors the caller handles on purpose. Never throws, never changes control flow. */
export function reportError(scope: string, error: unknown, context?: Record<string, unknown>) {
  try {
    sink(scope, describeError(error), context)
  } catch {
    /* Diagnostics must not affect execution. */
  }
}
