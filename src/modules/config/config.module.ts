import { Module } from '@nestjs/common'
import { ConfigModule as NestConfigModule } from '@nestjs/config'
import { z } from 'zod'
import { DEFAULT_OPENAI_MODEL } from './constants'

/**
 * Environment variables schema with Zod validation
 */
const envSchema = z
  .object({
    // Where invocations arrive: Discord in production, the terminal for the local console.
    GNOMO_TRANSPORT: z.enum(['discord', 'console']).default('discord'),

    // Discord
    BOT_TOKEN: z.string().min(1).optional(),
    GUILD_ID: z.string().min(1).optional(),
    GNOMOS_CHANNEL_ID: z.string().min(1).optional(),
    RUNTIME_MODE: z.enum(['paused', 'pilot', 'guild']).default('paused'),
    RUNTIME_CHANNEL_IDS: z.string().default(''),
    CONVERSATION_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),

    // External Services
    BUCKET_URL: z.string().url().optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_MODEL: z.string().default(DEFAULT_OPENAI_MODEL),
    OPENAI_IMAGE_MODEL: z.string().min(1).optional(),
    OPENAI_IMAGE_QUALITY: z.enum(['low', 'medium', 'high', 'auto']).optional(),
    BROWSERBASE_API_KEY: z.string().optional(),

    // Durable admission and scheduled notices; active runtime requires Redis.
    REDIS_URL: z.string().optional(),
    DATABASE_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    DATABASE_URL_POOLED: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    PILOT_MEMORY_DATABASE_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    PILOT_MEMORY_EMBEDDING_MODEL: z.string().min(1).optional(),
    MEMORY_OWNER_ID: z
      .string()
      .regex(/^\d{17,20}$/)
      .optional(),

    // Runtime
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
    // Include redacted request/reply text in conversation traces (off by default).
    LOG_CONTENT: z.enum(['true', 'false']).optional(),

    // Health check port
    PORT: z.coerce.number().default(3000),
  })
  .superRefine((env, ctx) => {
    if (env.RUNTIME_MODE !== 'paused') {
      const required = ['GUILD_ID', 'OPENAI_API_KEY', 'REDIS_URL'] as const
      // The console transport never logs into Discord, so it needs no token.
      for (const key of env.GNOMO_TRANSPORT === 'discord'
        ? (['BOT_TOKEN', ...required] as const)
        : required) {
        if (!env[key])
          ctx.addIssue({ code: 'custom', path: [key], message: 'Required for active runtime' })
      }
      if (env.RUNTIME_MODE === 'pilot' && !env.RUNTIME_CHANNEL_IDS.trim())
        ctx.addIssue({
          code: 'custom',
          path: ['RUNTIME_CHANNEL_IDS'],
          message: 'Pilot requires explicit channels',
        })
    }
  })

/**
 * Type for the validated environment
 */
export type Env = z.infer<typeof envSchema>

/**
 * Validate environment variables using Zod
 */
function validateEnv(env: Record<string, unknown>) {
  const result = envSchema.safeParse(env)

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    throw new Error(`❌ Environment validation failed:\n${errors}`)
  }

  return result.data
}

/**
 * Configuration schema export for @nestjs/config
 */
export const configSchema = () => envSchema

/**
 * Config module with Zod validation
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // Load .env.local first if it exists, then fallback to .env
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
