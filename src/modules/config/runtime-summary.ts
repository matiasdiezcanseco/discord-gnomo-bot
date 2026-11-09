import type { ConfigService } from '@nestjs/config'
import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_SPEECH_MODEL,
  DEFAULT_OPENAI_SPEECH_VOICE,
} from './constants'

/**
 * One startup line answering "what is this process actually running with?". Booleans only for
 * credentials and URLs; never their values.
 */
export function runtimeSummary(config: Pick<ConfigService, 'get'>) {
  const get = (key: string) => config.get<string>(key)?.toString().trim() || undefined
  const has = (key: string) => !!get(key)
  const owner = /^\d{17,20}$/.test(get('MEMORY_OWNER_ID') ?? '')
  const database =
    has('DATABASE_URL_POOLED') || has('DATABASE_URL') || has('PILOT_MEMORY_DATABASE_URL')
  const channels = (get('RUNTIME_CHANNEL_IDS') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  const disabled: string[] = []
  if (!has('OPENAI_API_KEY')) disabled.push('model (OPENAI_API_KEY)')
  if (!has('REDIS_URL')) disabled.push('claims/reminders/images (REDIS_URL)')
  if (!database) disabled.push('memory (no database URL)')
  else if (!owner) disabled.push('memory (MEMORY_OWNER_ID missing/invalid)')
  const mediaBucket =
    has('BUCKET_NAME') &&
    has('AWS_ENDPOINT_URL_S3') &&
    has('AWS_ACCESS_KEY_ID') &&
    has('AWS_SECRET_ACCESS_KEY')
  if (!mediaBucket) disabled.push('media library (BUCKET_NAME/AWS_* object storage)')
  else if (!database || !owner) disabled.push('media library (needs database and MEMORY_OWNER_ID)')
  if (!has('BUCKET_URL')) disabled.push('phrases/photos/birthdays (BUCKET_URL)')
  if (!has('BROWSERBASE_API_KEY')) disabled.push('web search/news (BROWSERBASE_API_KEY)')
  if (!has('GNOMOS_CHANNEL_ID')) disabled.push('birthday greetings (GNOMOS_CHANNEL_ID)')
  return {
    transport: get('GNOMO_TRANSPORT') ?? 'discord',
    runtimeMode: get('RUNTIME_MODE') ?? 'paused',
    runtimeChannels: channels.length,
    guildId: get('GUILD_ID') ?? null,
    model: get('OPENAI_MODEL') ?? `${DEFAULT_OPENAI_MODEL} (default)`,
    reasoningEffort: get('OPENAI_REASONING_EFFORT') ?? 'low',
    imageModel: get('OPENAI_IMAGE_MODEL') ?? DEFAULT_OPENAI_IMAGE_MODEL + ' (default)',
    imageQuality: get('OPENAI_IMAGE_QUALITY') ?? 'medium',
    speechModel: get('OPENAI_SPEECH_MODEL') ?? DEFAULT_OPENAI_SPEECH_MODEL + ' (default)',
    speechVoice: get('OPENAI_SPEECH_VOICE') ?? DEFAULT_OPENAI_SPEECH_VOICE + ' (default)',
    timeoutMs: Number(get('CONVERSATION_TIMEOUT_MS') ?? 60000),
    synthesisTimeoutMs: Number(get('CONVERSATION_SYNTHESIS_TIMEOUT_MS') ?? 20000),
    concurrency: Number(get('CONVERSATION_CONCURRENCY') ?? 4),
    configured: {
      BOT_TOKEN: has('BOT_TOKEN'),
      OPENAI_API_KEY: has('OPENAI_API_KEY'),
      REDIS_URL: has('REDIS_URL'),
      DATABASE_URL: has('DATABASE_URL'),
      DATABASE_URL_POOLED: has('DATABASE_URL_POOLED'),
      PILOT_MEMORY_DATABASE_URL: has('PILOT_MEMORY_DATABASE_URL'),
      MEMORY_OWNER_ID: owner,
      PILOT_MEMORY_EMBEDDING_MODEL: has('PILOT_MEMORY_EMBEDDING_MODEL'),
      BUCKET_URL: has('BUCKET_URL'),
      MEDIA_BUCKET: mediaBucket,
      BROWSERBASE_API_KEY: has('BROWSERBASE_API_KEY'),
      GNOMOS_CHANNEL_ID: has('GNOMOS_CHANNEL_ID'),
    },
    disabled,
    logContent: get('LOG_CONTENT') === 'true',
    nodeEnv: get('NODE_ENV') ?? 'development',
    logLevel: get('LOG_LEVEL') ?? null,
    // Fly sets these; they identify which deploy produced a log line.
    release: process.env.FLY_IMAGE_REF ?? process.env.FLY_MACHINE_VERSION ?? null,
    node: process.version,
  }
}
