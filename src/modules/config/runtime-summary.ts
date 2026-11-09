import type { ConfigService } from '@nestjs/config'
import { configuredFacts, enablement, runtimeSettings } from './runtime-settings'

/**
 * One startup line answering "what is this process actually running with?". Booleans only for
 * credentials and URLs; never their values.
 */
export function runtimeSummary(config: Pick<ConfigService, 'get'>) {
  const get = (key: string) => config.get<string>(key)?.toString().trim() || undefined
  const has = (key: string) => !!get(key)
  const settings = runtimeSettings(config)
  const facts = configuredFacts(config)
  const channels = (get('RUNTIME_CHANNEL_IDS') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  const defaulted = (key: string, value: string) => (has(key) ? value : `${value} (default)`)
  return {
    transport: get('GNOMO_TRANSPORT') ?? 'discord',
    runtimeMode: get('RUNTIME_MODE') ?? 'paused',
    runtimeChannels: channels.length,
    guildId: get('GUILD_ID') ?? null,
    // Effective values: what the conversation runs with after defaults and bounds.
    model: defaulted('OPENAI_MODEL', settings.model),
    reasoningEffort: settings.reasoningEffort ?? null,
    imageModel: defaulted('OPENAI_IMAGE_MODEL', settings.image.model),
    imageQuality: settings.image.quality,
    speechModel: defaulted('OPENAI_SPEECH_MODEL', settings.speech.model),
    speechVoice: defaulted('OPENAI_SPEECH_VOICE', settings.speech.voice),
    speechCooldownMinutes: settings.speech.cooldownMinutes,
    timeoutMs: settings.timeoutMs,
    synthesisTimeoutMs: settings.synthesisTimeoutMs,
    concurrency: settings.concurrency,
    configured: {
      BOT_TOKEN: has('BOT_TOKEN'),
      OPENAI_API_KEY: facts.openaiKey,
      REDIS_URL: has('REDIS_URL'),
      DATABASE_URL: has('DATABASE_URL'),
      DATABASE_URL_POOLED: has('DATABASE_URL_POOLED'),
      PILOT_MEMORY_DATABASE_URL: has('PILOT_MEMORY_DATABASE_URL'),
      MEMORY_OWNER_ID: facts.memoryOwner,
      PILOT_MEMORY_EMBEDDING_MODEL: has('PILOT_MEMORY_EMBEDDING_MODEL'),
      BUCKET_URL: has('BUCKET_URL'),
      MEDIA_BUCKET: facts.mediaBucket,
      BROWSERBASE_API_KEY: has('BROWSERBASE_API_KEY'),
      GNOMOS_CHANNEL_ID: has('GNOMOS_CHANNEL_ID'),
    },
    disabled: Object.values(enablement(facts))
      .filter((feature) => !feature.enabled)
      .map((feature) => `${feature.name} (${feature.reason})`),
    logContent: settings.logContent,
    nodeEnv: get('NODE_ENV') ?? 'development',
    logLevel: get('LOG_LEVEL') ?? null,
    // Fly sets these; they identify which deploy produced a log line.
    release: process.env.FLY_IMAGE_REF ?? process.env.FLY_MACHINE_VERSION ?? null,
    node: process.version,
  }
}
