import type { Client } from 'discord.js'
import { ChannelType, PermissionFlagsBits } from 'discord.js'
import type { ConfigService } from '@nestjs/config'
import { NoticeFailure, type ScheduledDelivery } from '../../conversation/scheduled-notices'
import type { Invocation } from '../../core/conversation/invocation'

export function discordScheduledDelivery(client: Client, config: ConfigService): ScheduledDelivery {
  async function channelFor(origin: Invocation) {
    if (origin.guildId !== config.get<string>('GUILD_ID') || !client.user) return null
    const guild = await client.guilds.fetch(origin.guildId)
    const channel = await guild.channels.fetch(origin.channelId, { force: true })
    if (!channel || !channel.isTextBased() || !channel.isSendable()) return null
    const [requester, bot] = await Promise.all([
      guild.members.fetch({ user: origin.requester.id, force: true }),
      guild.members.fetch({ user: client.user.id, force: true }),
    ])
    const read = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
    const send = channel.isThread()
      ? PermissionFlagsBits.SendMessagesInThreads
      : PermissionFlagsBits.SendMessages
    if (
      !channel.permissionsFor(requester)?.has(read) ||
      !channel.permissionsFor(bot)?.has([...read, send])
    )
      return null
    if (channel.isThread() && (channel.archived || channel.locked)) return null
    if (channel.type === ChannelType.PrivateThread && channel.isThread())
      await Promise.all([channel.members.fetch(requester.id), channel.members.fetch(bot.id)])
    return channel
  }
  return {
    authorize: async (origin) => !!(await channelFor(origin)),
    send: async (origin, reply) => {
      const channel = await channelFor(origin)
      if (!channel) throw new NoticeFailure('permanent', 'permission revoked before send')
      try {
        await channel.send(reply)
      } catch (error) {
        const status =
          typeof error === 'object' && error !== null && 'status' in error ? error.status : null
        if (status === 429)
          throw new NoticeFailure('transient', 'Discord explicitly rejected with rate limit')
        if (status === 403 || status === 404 || status === 400)
          throw new NoticeFailure('permanent', `Discord rejected: ${status}`)
        throw new NoticeFailure('uncertain', 'Discord acceptance unknown')
      }
    },
  }
}
