import type { Client } from 'discord.js'
import { ChannelType, PermissionFlagsBits } from 'discord.js'
import type { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { openai } from '@ai-sdk/openai'
import { createConversation, type ConversationPorts } from '../../conversation/harness'
import { aiSdkModel } from '../../conversation/ai-sdk-model'
import { pilotCatalog } from '../../conversation/pilot-catalog'
import { redisClaims } from '../../conversation/redis-claims'
import { discordMembers } from './members'
import { memberMentions } from '../../conversation/member-mentions'
import { bucketCollection } from '../../conversation/collection-content'

export function composePilot(
  client: Client,
  config: ConfigService,
  redis: Redis | null,
  trace: ConversationPorts['trace'],
  model = aiSdkModel(openai(config.get<string>('OPENAI_MODEL', 'gpt-4o-mini'))),
  memberFetch: typeof fetch = fetch,
) {
  const members = discordMembers(client, memberFetch)
  return createConversation({
    model,
    catalog: pilotCatalog(bucketCollection(config.get<string>('BUCKET_URL')), members),
    allowedUserMentions: memberMentions(members),
    trace,
    concurrency: config.get<number>('CONVERSATION_CONCURRENCY', 4),
    claim: redis
      ? redisClaims(redis)
      : async () => {
          throw new Error('Redis unavailable')
        },
    authorize: async (invocation, tool) => {
      if (invocation.guildId !== config.get<string>('GUILD_ID')) return false
      if (
        !config
          .get<string>('CONVERSATION_PILOT_CHANNEL_IDS', '')
          .split(',')
          .map((id) => id.trim())
          .includes(invocation.channelId)
      )
        return false
      // Fresh membership and channel data; model arguments never participate in this lookup.
      const guild = await client.guilds.fetch(invocation.guildId)
      const channel = await guild.channels.fetch(invocation.channelId, { force: true })
      if (!channel || !channel.isTextBased() || !client.user) return false
      const [requester, bot] = await Promise.all([
        guild.members.fetch({ user: invocation.requester.id, force: true }),
        guild.members.fetch({ user: client.user.id, force: true }),
      ])
      const read = PermissionFlagsBits.ViewChannel
      const send = channel.isThread()
        ? PermissionFlagsBits.SendMessagesInThreads
        : PermissionFlagsBits.SendMessages
      if (
        !channel.permissionsFor(requester)?.has(read) ||
        !channel.permissionsFor(bot)?.has([read, send])
      )
        return false
      if (channel.isThread() && (channel.archived || channel.locked)) return false
      if (channel.type === ChannelType.PrivateThread && channel.isThread()) {
        try {
          await Promise.all([channel.members.fetch(requester.id), channel.members.fetch(bot.id)])
        } catch {
          return false
        }
      }
      return (
        !tool ||
        (['pilot.status', 'collection.phrase', 'collection.photo', 'discord.members'].includes(
          tool.capability,
        ) &&
          tool.effect === 'read')
      )
    },
    // Delivery is bound to the originating Discord message by the sole receiver.
    reply: async () => {
      throw new Error('Origin reply transport required')
    },
  })
}
