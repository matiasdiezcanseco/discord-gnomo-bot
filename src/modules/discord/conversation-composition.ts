import type { Client } from 'discord.js'
import type { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { effectiveChannelAccess } from './effective-channel-access'
import { discordMembers } from './members'
import { discordHistory } from './channel-history'
import { discordReactions } from './reactions'
import { discordLiveMembers } from './live-members'
import type { ConversationPorts } from '../../conversation/harness'
import type { MemoryDependencies } from '../../conversation/explicit-memory'
import type { SafeReader } from '../../web/safe-reader'
import {
  composeRuntimeConversation,
  type ConversationPlatform,
} from '../../conversation/composition'

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

/** Discord members, presence, voice, history and live channel permissions. */
export function discordPlatform(
  client: Client,
  fetcher: typeof fetch = fetch,
): ConversationPlatform {
  const members = discordMembers(client, fetcher)
  return {
    async access(invocation, signal) {
      const guild = await client.guilds.fetch(invocation.guildId)
      signal?.throwIfAborted()
      if (!client.user) return false
      // Runs before every tool and reply chunk. Members come from the gateway-maintained cache
      // (GuildMembers intent pushes role changes); forcing them exhausts Discord's member bucket.
      const [channel, requester, bot] = await Promise.all([
        guild.channels.fetch(invocation.channelId, { force: true }),
        guild.members.fetch({ user: invocation.requester.id }),
        guild.members.fetch({ user: client.user.id }),
      ])
      signal?.throwIfAborted()
      if (!channel || !channel.isTextBased()) return false
      return effectiveChannelAccess(channel, requester, bot, signal, true)
    },
    members,
    reactions: (authorize) => discordReactions(client, authorize, fetcher),
    live: discordLiveMembers(client, members),
    history: (authorize, cacheEnabled) => discordHistory(client, authorize, fetcher, cacheEnabled),
  }
}

export function composeConversation({
  client,
  discordFetch = fetch,
  ...runtime
}: ConversationComposition) {
  return composeRuntimeConversation({ ...runtime, platform: discordPlatform(client, discordFetch) })
}
