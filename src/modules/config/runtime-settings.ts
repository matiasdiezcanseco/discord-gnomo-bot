import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_SPEECH_MODEL,
  DEFAULT_OPENAI_SPEECH_VOICE,
} from './constants'

/** Nest's ConfigService or any stand-in; values may be raw strings or already coerced. */
export interface SettingsSource {
  get(key: string): unknown
}

const reasoningEfforts = ['minimal', 'low', 'medium', 'high'] as const
const imageQualities = ['low', 'medium', 'high', 'auto'] as const

/**
 * The single reading of the tunable environment: every default, bound and fallback lives here.
 * Out-of-range or unrecognised values fall back instead of failing, so a typo never stops replies.
 */
export function runtimeSettings(source: SettingsSource) {
  const text = (key: string) => source.get(key)?.toString().trim() || undefined
  const oneOf = <T extends string>(key: string, allowed: readonly T[]) =>
    allowed.find((value) => value === text(key))
  const integer = (key: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) => {
    const value = Number(text(key) ?? fallback)
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback
  }
  const owner = text('MEMORY_OWNER_ID')
  return {
    openaiApiKey: text('OPENAI_API_KEY'),
    model: text('OPENAI_MODEL') ?? DEFAULT_OPENAI_MODEL,
    /** Unset means low; any other unrecognised value (even empty) sends no reasoning option. */
    reasoningEffort:
      source.get('OPENAI_REASONING_EFFORT') === undefined
        ? ('low' as const)
        : oneOf('OPENAI_REASONING_EFFORT', reasoningEfforts),
    image: {
      model: text('OPENAI_IMAGE_MODEL') ?? DEFAULT_OPENAI_IMAGE_MODEL,
      quality: oneOf('OPENAI_IMAGE_QUALITY', imageQualities) ?? ('medium' as const),
    },
    speech: {
      model: text('OPENAI_SPEECH_MODEL') ?? DEFAULT_OPENAI_SPEECH_MODEL,
      voice: text('OPENAI_SPEECH_VOICE') ?? DEFAULT_OPENAI_SPEECH_VOICE,
      cooldownMinutes: integer('OPENAI_SPEECH_COOLDOWN_MINUTES', 10, 1, 1440),
    },
    concurrency: integer('CONVERSATION_CONCURRENCY', 4, 1, 16),
    timeoutMs: integer('CONVERSATION_TIMEOUT_MS', 60000, 1),
    /** 0 disables the synthesis turn. */
    synthesisTimeoutMs: integer('CONVERSATION_SYNTHESIS_TIMEOUT_MS', 20000, 0),
    logContent: text('LOG_CONTENT') === 'true',
    /** Deployment configuration only; an invalid ID is the same as none. */
    memoryOwnerId: owner && /^\d{17,20}$/.test(owner) ? owner : undefined,
    collectionUrl: text('BUCKET_URL'),
    searchApiKey: text('BROWSERBASE_API_KEY'),
  }
}
export type RuntimeSettings = ReturnType<typeof runtimeSettings>

/** What exists for this process. Configuration can only promise it; composition knows it. */
export interface RuntimeFacts {
  openaiKey: boolean
  redis: boolean
  database: boolean
  memoryOwner: boolean
  mediaBucket: boolean
  collection: boolean
  search: boolean
  birthdayChannel: boolean
}

/** Facts as the environment promises them, before anything is connected. */
export function configuredFacts(source: SettingsSource): RuntimeFacts {
  const has = (key: string) => !!source.get(key)?.toString().trim()
  const settings = runtimeSettings(source)
  return {
    openaiKey: !!settings.openaiApiKey,
    redis: has('REDIS_URL'),
    database: has('DATABASE_URL_POOLED') || has('DATABASE_URL') || has('PILOT_MEMORY_DATABASE_URL'),
    memoryOwner: !!settings.memoryOwnerId,
    mediaBucket:
      has('BUCKET_NAME') &&
      has('AWS_ENDPOINT_URL_S3') &&
      has('AWS_ACCESS_KEY_ID') &&
      has('AWS_SECRET_ACCESS_KEY'),
    collection: !!settings.collectionUrl,
    search: !!settings.searchApiKey,
    birthdayChannel: has('GNOMOS_CHANNEL_ID'),
  }
}

/**
 * What each feature needs, written once. The first unmet requirement is the reason it is off;
 * `false` means every requirement is met. Composition and the startup summary both read this.
 */
const requirements = {
  model: { name: 'model', missing: (f) => !f.openaiKey && 'OPENAI_API_KEY' },
  reminders: { name: 'claims/reminders', missing: (f) => !f.redis && 'REDIS_URL' },
  // Without Redis there is no shared per-user cooldown, so paid generation stays off.
  images: { name: 'image creation', missing: (f) => !f.redis && 'REDIS_URL' },
  speech: {
    name: 'voice messages',
    missing: (f) => (!f.redis && 'REDIS_URL') || (!f.openaiKey && 'OPENAI_API_KEY'),
  },
  memory: {
    name: 'memory',
    missing: (f) =>
      (!f.database && 'no database URL') || (!f.memoryOwner && 'MEMORY_OWNER_ID missing/invalid'),
  },
  media: {
    name: 'media library',
    missing: (f) =>
      (!f.mediaBucket && 'BUCKET_NAME/AWS_* object storage') ||
      ((!f.database || !f.memoryOwner) && 'needs database and MEMORY_OWNER_ID'),
  },
  collection: { name: 'phrases/photos/birthdays', missing: (f) => !f.collection && 'BUCKET_URL' },
  search: { name: 'web search/news', missing: (f) => !f.search && 'BROWSERBASE_API_KEY' },
  birthdays: {
    name: 'birthday greetings',
    missing: (f) => !f.birthdayChannel && 'GNOMOS_CHANNEL_ID',
  },
} satisfies Record<string, { name: string; missing(facts: RuntimeFacts): string | false }>

export type Feature = keyof typeof requirements
export interface Enablement {
  enabled: boolean
  name: string
  /** Why it is off; absent when enabled. */
  reason?: string
}

export function enablement(facts: RuntimeFacts): Record<Feature, Enablement> {
  return Object.fromEntries(
    Object.entries(requirements).map(([feature, { name, missing }]) => {
      const reason = missing(facts)
      return [feature, reason ? { enabled: false, name, reason } : { enabled: true, name }]
    }),
  ) as Record<Feature, Enablement>
}
