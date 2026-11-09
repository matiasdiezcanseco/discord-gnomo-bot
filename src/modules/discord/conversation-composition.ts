import { DEFAULT_OPENAI_MODEL } from '../config/constants'
import { runtimeAllows } from '../../conversation/runtime-policy'
import { tavilySearch } from '../../conversation/public-search'
import type { Client } from 'discord.js'
import { effectiveChannelAccess } from './effective-channel-access'
import type { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { openai } from '@ai-sdk/openai'
import { createConversation, type ConversationPorts } from '../../conversation/harness'
import { aiSdkModel } from '../../conversation/ai-sdk-model'
import { composeCapabilities } from '../../conversation/capabilities'
import { redisClaims } from '../../conversation/redis-claims'
import { discordMembers } from './members'
import { memberMentions } from '../../conversation/member-mentions'
import { discordHistory } from './channel-history'
import { bucketCollection } from '../../conversation/collection-content'
import { memoryCapabilities, type MemoryDependencies } from '../../conversation/explicit-memory'
import { safeReader, type SafeReader } from '../../web/safe-reader'
import { discordLiveMembers } from './live-members'
import { attachedImages } from '../../conversation/attached-images'
import { ScheduledNotices } from '../../conversation/scheduled-notices'
import { capabilityAllowed } from '../../conversation/execution-policy'

export interface ConversationComposition {
  client: Client
  config: ConfigService
  redis: Redis | null
  clock?: ConversationPorts['clock']
  trace?: ConversationPorts['trace']
  model?: ConversationPorts['model']
  discordFetch?: typeof fetch
  web?: SafeReader
  memory?: MemoryDependencies
}
function reasoningEffort(config: ConfigService) {
  const effort = config.get<string>('OPENAI_REASONING_EFFORT', 'low')
  return effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high'
    ? effort
    : undefined
}
export function composeConversation({
  client,
  config,
  redis,
  trace,
  clock,
  model = aiSdkModel(
    openai(config.get<string>('OPENAI_MODEL', DEFAULT_OPENAI_MODEL)),
    1500,
    reasoningEffort(config),
  ),
  discordFetch = fetch,
  web = safeReader(),
  memory,
}: ConversationComposition) {
  const members = discordMembers(client, discordFetch)
  const authorize: ConversationPorts['authorize'] = async (invocation, tool, signal) => {
    signal?.throwIfAborted()
    if (!runtimeAllows(config, invocation)) return false
    // Fresh membership and channel data; model arguments never participate in this lookup.
    const guild = await client.guilds.fetch(invocation.guildId)
    signal?.throwIfAborted()
    if (!client.user) return false
    // Independent forced reads run concurrently: this runs before every tool and reply chunk.
    const [channel, requester, bot] = await Promise.all([
      guild.channels.fetch(invocation.channelId, { force: true }),
      guild.members.fetch({ user: invocation.requester.id, force: true }),
      guild.members.fetch({ user: client.user.id, force: true }),
    ])
    signal?.throwIfAborted()
    if (!channel || !channel.isTextBased()) return false
    if (!(await effectiveChannelAccess(channel, requester, bot, signal, true))) return false
    return enabled(invocation, tool)
  }
  const enabled: ConversationPorts['authorize'] = async (invocation, tool) =>
    capabilityAllowed(invocation, tool)
  // With durable memory enabled, never retain history pages that may contain old memory replies.
  const history = discordHistory(
    client,
    (invocation, signal) => authorize(invocation, undefined, signal),
    discordFetch,
    !memory,
  )
  return createConversation({
    loadImages: async (context) => {
      const images = await attachedImages(web)({
        ...context,
        external: async (work) => {
          if (!(await authorize(context.invocation, undefined, context.signal)))
            throw new Error('permission revoked')
          return context.external(work)
        },
      })
      return images
    },
    loadContext: async (context) => history(context, 30),
    model,
    catalog: composeCapabilities({
      collection: bucketCollection(config.get<string>('BUCKET_URL')),
      members: members,
      history: history,
      search: tavilySearch(config.get<string>('TAVILY_API_KEY')),
      live: discordLiveMembers(client, members),
      web: web,
      memory: memoryCapabilities(
        memory,
        config.get<string>('MEMORY_OWNER_ID'),
        (invocation, signal) => authorize(invocation, undefined, signal),
      ),
      notices: redis ? new ScheduledNotices(redis) : undefined,
    }),
    allowedUserMentions: memberMentions(members),
    trace,
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
    // Delivery is bound to the originating Discord message by the sole receiver.
    reply: async () => {
      throw new Error('Origin reply transport required')
    },
  })
}
