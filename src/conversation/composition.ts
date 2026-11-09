import type { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { openai } from '@ai-sdk/openai'
import { configuredFacts, enablement, runtimeSettings } from '../modules/config/runtime-settings'
import type { Invocation } from '../core/conversation/invocation'
import { runtimeAllows } from './runtime-policy'
import { browserbaseSearch } from './public-search'
import { createConversation, type ConversationPorts } from './harness'
import { aiSdkModel } from './ai-sdk-model'
import { composeCapabilities } from './capabilities'
import { redisClaims } from './redis-claims'
import { memberMentions } from './member-mentions'
import { bucketCollection } from './collection-content'
import { memoryCapabilities, type MemoryDependencies } from './explicit-memory'
import { safeReader, type SafeReader } from '../web/safe-reader'
import { attachedImages } from './attached-images'
import { mediaCapabilities, s3MediaStore, type MediaObjectStore } from './media-library'
import { ScheduledNotices } from './scheduled-notices'
import { aiSdkImages } from './image-generation'
import { redisCooldown } from './paid-generation'
import { openaiRealtimeSpeech } from './speech-generation'
import type { MemberDirectory } from './member-directory'
import type { LiveMembers } from './live-members'
import type { HistoryReader } from './channel-history'

/**
 * Everything that depends on where messages live (Discord or the local console). The rest of the
 * conversation runtime — model, persona, budgets, tools, memory, reminders — is shared verbatim.
 */
export interface ConversationPlatform {
  /** Live requester/bot access to the invocation channel, after deployment policy passed. */
  access(invocation: Invocation, signal?: AbortSignal): Promise<boolean>
  members: MemberDirectory
  live: LiveMembers
  history(
    authorize: (invocation: Invocation, signal?: AbortSignal) => Promise<boolean>,
    cacheEnabled: boolean,
  ): HistoryReader
}

export interface RuntimeComposition {
  platform: ConversationPlatform
  config: ConfigService
  redis: Redis | null
  clock?: ConversationPorts['clock']
  trace?: ConversationPorts['trace']
  model?: ConversationPorts['model']
  web?: SafeReader
  memory?: MemoryDependencies
  /** Defaults to the S3-compatible bucket from BUCKET_NAME/AWS_* configuration. */
  mediaStore?: MediaObjectStore
}

export function composeRuntimeConversation({
  platform,
  config,
  redis,
  trace,
  clock,
  model,
  web = safeReader(),
  memory,
  mediaStore = s3MediaStore((key) => config.get<string>(key)),
}: RuntimeComposition) {
  const settings = runtimeSettings(config)
  // The environment promises; what was actually connected decides.
  const on = enablement({
    ...configuredFacts(config),
    redis: !!redis,
    database: !!memory,
    mediaBucket: !!mediaStore,
  })
  // Every tool in the catalog is permitted by its own definition, so authorization is only
  // about where and who: deployment policy, then fresh platform access.
  const authorize: ConversationPorts['authorize'] = async (invocation, _tool, signal) => {
    signal?.throwIfAborted()
    if (!runtimeAllows(config, invocation)) return false
    // Fresh platform data; model arguments never participate in this lookup.
    return platform.access(invocation, signal)
  }
  // With durable memory enabled, never retain history pages that may contain old memory replies.
  const history = platform.history(
    (invocation, signal) => authorize(invocation, undefined, signal),
    !memory,
  )
  const loadImages: NonNullable<ConversationPorts['loadImages']> = async (context) =>
    attachedImages(web)({
      ...context,
      external: async (work) => {
        if (!(await authorize(context.invocation, undefined, context.signal)))
          throw new Error('permission revoked')
        return context.external(work)
      },
    })
  const reauthorize = (invocation: Invocation, signal?: AbortSignal) =>
    authorize(invocation, undefined, signal)
  return createConversation({
    loadImages,
    loadContext: async (context) => history(context, 30),
    model: model ?? aiSdkModel(openai(settings.model), 1500, settings.reasoningEffort),
    catalog: composeCapabilities({
      collection: bucketCollection(settings.collectionUrl),
      members: platform.members,
      history,
      search: browserbaseSearch(settings.searchApiKey),
      live: platform.live,
      web,
      memory: memoryCapabilities(
        on.memory.enabled ? memory : undefined,
        settings.memoryOwnerId,
        reauthorize,
      ),
      media: mediaCapabilities(
        on.media.enabled && memory && mediaStore
          ? { pool: memory.pool, embedding: memory.embedding, store: mediaStore, loadImages }
          : undefined,
        settings.memoryOwnerId,
        reauthorize,
      ),
      notices: on.reminders.enabled && redis ? new ScheduledNotices(redis) : undefined,
      images:
        on.images.enabled && redis
          ? {
              generator: aiSdkImages(openai.image(settings.image.model), settings.image.quality),
              cooldown: redisCooldown(redis, 3600, 'gnomo:image-quota:v1'),
            }
          : undefined,
      speech:
        on.speech.enabled && redis && settings.openaiApiKey
          ? {
              generator: openaiRealtimeSpeech({
                apiKey: settings.openaiApiKey,
                model: settings.speech.model,
                voice: settings.speech.voice,
              }),
              cooldown: redisCooldown(
                redis,
                settings.speech.cooldownMinutes * 60,
                'gnomo:speech-quota:v1',
              ),
              cooldownMinutes: settings.speech.cooldownMinutes,
            }
          : undefined,
    }),
    allowedUserMentions: memberMentions(platform.members),
    trace,
    // Opt-in: request/reply text (redacted, truncated) in traces for debugging.
    traceContent: settings.logContent,
    clock,
    concurrency: settings.concurrency,
    timeoutMs: settings.timeoutMs,
    synthesisTimeoutMs: settings.synthesisTimeoutMs,
    claim: redis
      ? redisClaims(redis)
      : async () => {
          throw new Error('Redis unavailable')
        },
    authorize,
    // Discovery needs no second platform lookup: the invocation was authorized before the loop.
    discover: async () => true,
    // Delivery is bound to the originating message by the sole receiver.
    reply: async () => {
      throw new Error('Origin reply transport required')
    },
  })
}
