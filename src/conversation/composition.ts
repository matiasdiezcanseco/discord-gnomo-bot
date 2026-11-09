import type { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { openai } from '@ai-sdk/openai'
import { DEFAULT_OPENAI_MODEL } from '../modules/config/constants'
import type { Invocation } from '../core/conversation/invocation'
import { runtimeAllows } from './runtime-policy'
import { tavilySearch } from './public-search'
import { createConversation, type ConversationPorts } from './harness'
import { aiSdkModel } from './ai-sdk-model'
import { composeCapabilities } from './capabilities'
import { redisClaims } from './redis-claims'
import { memberMentions } from './member-mentions'
import { bucketCollection } from './collection-content'
import { memoryCapabilities, type MemoryDependencies } from './explicit-memory'
import { safeReader, type SafeReader } from '../web/safe-reader'
import { attachedImages } from './attached-images'
import { ScheduledNotices } from './scheduled-notices'
import { capabilityAllowed } from './execution-policy'
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
}

function reasoningEffort(config: ConfigService) {
  const effort = config.get<string>('OPENAI_REASONING_EFFORT', 'low')
  return effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high'
    ? effort
    : undefined
}

export function composeRuntimeConversation({
  platform,
  config,
  redis,
  trace,
  clock,
  model = aiSdkModel(
    openai(config.get<string>('OPENAI_MODEL', DEFAULT_OPENAI_MODEL)),
    1500,
    reasoningEffort(config),
  ),
  web = safeReader(),
  memory,
}: RuntimeComposition) {
  const enabled: ConversationPorts['authorize'] = async (invocation, tool) =>
    capabilityAllowed(invocation, tool)
  const authorize: ConversationPorts['authorize'] = async (invocation, tool, signal) => {
    signal?.throwIfAborted()
    if (!runtimeAllows(config, invocation)) return false
    // Fresh platform data; model arguments never participate in this lookup.
    if (!(await platform.access(invocation, signal))) return false
    return enabled(invocation, tool)
  }
  // With durable memory enabled, never retain history pages that may contain old memory replies.
  const history = platform.history(
    (invocation, signal) => authorize(invocation, undefined, signal),
    !memory,
  )
  return createConversation({
    loadImages: async (context) =>
      attachedImages(web)({
        ...context,
        external: async (work) => {
          if (!(await authorize(context.invocation, undefined, context.signal)))
            throw new Error('permission revoked')
          return context.external(work)
        },
      }),
    loadContext: async (context) => history(context, 30),
    model,
    catalog: composeCapabilities({
      collection: bucketCollection(config.get<string>('BUCKET_URL')),
      members: platform.members,
      history,
      search: tavilySearch(config.get<string>('TAVILY_API_KEY')),
      live: platform.live,
      web,
      memory: memoryCapabilities(
        memory,
        config.get<string>('MEMORY_OWNER_ID'),
        (invocation, signal) => authorize(invocation, undefined, signal),
      ),
      notices: redis ? new ScheduledNotices(redis) : undefined,
    }),
    allowedUserMentions: memberMentions(platform.members),
    trace,
    // Opt-in: request/reply text (redacted, truncated) in traces for debugging.
    traceContent: config.get<string>('LOG_CONTENT') === 'true',
    clock,
    concurrency: config.get<number>('CONVERSATION_CONCURRENCY', 4),
    timeoutMs: Number(config.get('CONVERSATION_TIMEOUT_MS', 60000)) || 60000,
    synthesisTimeoutMs: Number(config.get('CONVERSATION_SYNTHESIS_TIMEOUT_MS', 20000)) || 0,
    claim: redis
      ? redisClaims(redis)
      : async () => {
          throw new Error('Redis unavailable')
        },
    authorize,
    discover: enabled,
    // Delivery is bound to the originating message by the sole receiver.
    reply: async () => {
      throw new Error('Origin reply transport required')
    },
  })
}
