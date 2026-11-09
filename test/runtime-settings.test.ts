import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  configuredFacts,
  enablement,
  runtimeSettings,
  type RuntimeFacts,
} from '../src/modules/config/runtime-settings'
import { runtimeSummary } from '../src/modules/config/runtime-summary'
import { composeRuntimeConversation } from '../src/conversation/composition'
import type { ModelInput } from '../src/conversation/harness'

const source = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] })

const everything: RuntimeFacts = {
  openaiKey: true,
  redis: true,
  database: true,
  memoryOwner: true,
  mediaBucket: true,
  collection: true,
  search: true,
  birthdayChannel: true,
}
const off = (facts: Partial<RuntimeFacts>) =>
  Object.entries(enablement({ ...everything, ...facts }))
    .filter(([, feature]) => !feature.enabled)
    .map(([name, feature]) => `${name}: ${feature.reason}`)

test('each feature is off for the first requirement it is missing', () => {
  assert.deepEqual(off({}), [])
  assert.deepEqual(off({ redis: false }), [
    'reminders: REDIS_URL',
    'images: REDIS_URL',
    'speech: REDIS_URL',
  ])
  assert.deepEqual(off({ openaiKey: false }), ['model: OPENAI_API_KEY', 'speech: OPENAI_API_KEY'])
  assert.deepEqual(off({ database: false }), [
    'memory: no database URL',
    'media: needs database and MEMORY_OWNER_ID',
  ])
  assert.deepEqual(off({ memoryOwner: false }), [
    'memory: MEMORY_OWNER_ID missing/invalid',
    'media: needs database and MEMORY_OWNER_ID',
  ])
  assert.deepEqual(off({ mediaBucket: false }), ['media: BUCKET_NAME/AWS_* object storage'])
  assert.deepEqual(off({ collection: false }), ['collection: BUCKET_URL'])
  assert.deepEqual(off({ search: false }), ['search: BROWSERBASE_API_KEY'])
  assert.deepEqual(off({ birthdayChannel: false }), ['birthdays: GNOMOS_CHANNEL_ID'])
})

test('the environment is read into facts without trusting blank or malformed values', () => {
  const facts = configuredFacts(
    source({
      OPENAI_API_KEY: '  ',
      REDIS_URL: 'redis://localhost',
      DATABASE_URL_POOLED: 'postgresql://u:p@host/db',
      MEMORY_OWNER_ID: '123',
      BUCKET_NAME: 'gnomo-media',
      AWS_ENDPOINT_URL_S3: 'https://fly.storage.tigris.dev',
      AWS_ACCESS_KEY_ID: 'tid',
    }),
  )
  assert.deepEqual(facts, {
    ...everything,
    openaiKey: false,
    memoryOwner: false,
    mediaBucket: false,
    collection: false,
    search: false,
    birthdayChannel: false,
  })
})

test('settings apply defaults and bounds once, for raw and coerced values alike', () => {
  const defaults = runtimeSettings(source({}))
  assert.equal(defaults.reasoningEffort, 'low')
  assert.equal(defaults.image.quality, 'medium')
  assert.equal(defaults.speech.cooldownMinutes, 10)
  assert.deepEqual(
    [defaults.concurrency, defaults.timeoutMs, defaults.synthesisTimeoutMs],
    [4, 60000, 20000],
  )
  assert.equal(defaults.logContent, false)

  const set = runtimeSettings(
    source({
      OPENAI_REASONING_EFFORT: 'high',
      OPENAI_IMAGE_QUALITY: 'auto',
      OPENAI_SPEECH_COOLDOWN_MINUTES: '45',
      CONVERSATION_CONCURRENCY: 8,
      CONVERSATION_TIMEOUT_MS: '90000',
      CONVERSATION_SYNTHESIS_TIMEOUT_MS: 0,
      MEMORY_OWNER_ID: '123456789012345678',
      LOG_CONTENT: 'true',
    }),
  )
  assert.equal(set.reasoningEffort, 'high')
  assert.equal(set.image.quality, 'auto')
  assert.equal(set.speech.cooldownMinutes, 45)
  assert.deepEqual([set.concurrency, set.timeoutMs, set.synthesisTimeoutMs], [8, 90000, 0])
  assert.equal(set.memoryOwnerId, '123456789012345678')
  assert.equal(set.logContent, true)

  const invalid = runtimeSettings(
    source({
      OPENAI_REASONING_EFFORT: 'none',
      OPENAI_IMAGE_QUALITY: 'ultra',
      OPENAI_SPEECH_COOLDOWN_MINUTES: '0',
      CONVERSATION_CONCURRENCY: '99',
      CONVERSATION_TIMEOUT_MS: 'soon',
      MEMORY_OWNER_ID: 'ana',
    }),
  )
  assert.equal(invalid.reasoningEffort, undefined, 'unrecognised effort sends no option')
  assert.equal(invalid.image.quality, 'medium')
  assert.equal(invalid.speech.cooldownMinutes, 10)
  assert.deepEqual([invalid.concurrency, invalid.timeoutMs], [4, 60000])
  assert.equal(invalid.memoryOwnerId, undefined)
})

test('the startup summary names every feature the environment leaves off', () => {
  const { disabled } = runtimeSummary(source({ OPENAI_API_KEY: 'sk-x' }) as never)
  for (const feature of ['claims/reminders', 'image creation', 'voice messages'])
    assert.ok(disabled.includes(`${feature} (REDIS_URL)`), feature)
  assert.ok(!disabled.some((line) => line.startsWith('model')))
})

/** Which generation tools the composed conversation actually offers the model. */
async function offered(values: Record<string, unknown>) {
  let tools: string[] = []
  const conversation = composeRuntimeConversation({
    platform: {
      access: async () => true,
      members: {} as never,
      live: {} as never,
      history: () => (async () => []) as never,
    },
    config: {
      get: (key: string, fallback?: unknown) =>
        ({ GUILD_ID: 'g', RUNTIME_MODE: 'guild', ...values })[key] ?? fallback,
    } as never,
    // Only the invocation claim reaches Redis here; without Redis nothing is admitted at all.
    redis: { set: async () => 'OK' } as never,
    mediaStore: undefined,
    model: {
      generate: async (input: ModelInput) => {
        tools = input.tools.map((tool) => tool.name)
        return { text: 'listo', calls: [] }
      },
    },
  })
  await conversation.handle(
    {
      messageId: 'm',
      guildId: 'g',
      channelId: 'c',
      requester: { id: 'u', username: 'Ana' },
      content: 'hola',
      createdAt: Date.now(),
      attachments: [],
    },
    async () => undefined,
  )
  return tools.filter((name) => name.endsWith('_generate')).sort()
}

test('composition offers paid generation exactly when its requirements hold', async () => {
  assert.deepEqual(await offered({ OPENAI_API_KEY: 'sk-x' }), ['image_generate', 'speech_generate'])
  assert.deepEqual(await offered({}), ['image_generate'], 'voice needs the OpenAI key')
})
