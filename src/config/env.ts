import { z } from 'zod'
import {
  DEFAULT_CONVERSATION_TTL,
  DEFAULT_MAX_MESSAGES,
  DEFAULT_OPENAI_MODEL,
} from './constants.ts'

/**
 * Environment variables schema with Zod validation
 */
const envSchema = z.object({
  // Discord
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  GUILD_ID: z.string().min(1, 'GUILD_ID is required'),
  GNOMOS_CHANNEL_ID: z.string().min(1, 'GNOMOS_CHANNEL_ID is required'),
  TEST_CHANNEL_ID: z.string().optional(),

  // External Services
  BUCKET_URL: z.string().url('BUCKET_URL must be a valid URL'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default(DEFAULT_OPENAI_MODEL),
  TAVILY_API_KEY: z.string().optional(),

  // Redis (optional - history feature disabled if not configured)
  REDIS_URL: z.string().optional(),
  CONVERSATION_TTL: z.coerce.number().default(DEFAULT_CONVERSATION_TTL),
  MAX_CONVERSATION_MESSAGES: z.coerce.number().default(DEFAULT_MAX_MESSAGES),

  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
})

/**
 * Parse and validate environment variables
 * Throws detailed error if validation fails
 */
function parseEnv() {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    console.error('❌ Environment validation failed:\n' + errors)
    process.exit(1)
  }

  return result.data
}

/**
 * Validated environment variables
 * Access all env vars through this single export
 */
export const ENV = parseEnv()

/**
 * Type for the validated environment
 */
export type Env = z.infer<typeof envSchema>
