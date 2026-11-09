import { effectiveChannelAccess } from './effective-channel-access'
import { runtimeAllows } from '../../conversation/runtime-policy'
import type { Client } from 'discord.js'
import { ChannelType } from 'discord.js'
import type { ConfigService } from '@nestjs/config'
import {
  isBirthday,
  NoticeFailure,
  type ScheduledDelivery,
  type ScheduledOrigin,
} from '../../conversation/scheduled-notices'
import { birthdayStillDue, type BirthdaySource } from '../../conversation/birthdays'
import { reportError } from '../../diagnostics'

export function discordScheduledDelivery(
  client: Client,
  config: ConfigService,
  source?: BirthdaySource,
  now = Date.now,
): ScheduledDelivery {
  async function channelFor(origin: ScheduledOrigin) {
    if (!runtimeAllows(config, origin) || !client.user) return null
    if (
      isBirthday(origin) &&
      !(await birthdayStillDue(origin, config.get<string>('GNOMOS_CHANNEL_ID'), source, now()))
    )
      return null
    const guild = await client.guilds.fetch(origin.guildId)
    const channel = await guild.channels.fetch(origin.channelId, { force: true })
    if (!channel || !channel.isTextBased() || !channel.isSendable()) return null
    if (
      isBirthday(origin) &&
      (channel.guildId !== origin.guildId || channel.type !== ChannelType.GuildText)
    )
      return null
    const [requester, bot] = await Promise.all([
      guild.members.fetch({ user: origin.requester.id }),
      guild.members.fetch({ user: client.user.id }),
    ])
    if (!(await effectiveChannelAccess(channel, requester, bot))) return null
    return channel
  }
  return {
    admits: (origin) => runtimeAllows(config, origin),
    authorize: async (origin) => {
      try {
        return !!(await channelFor(origin))
      } catch (error) {
        reportError('notices.authorize', error, { channelId: origin.channelId })
        const status =
          typeof error === 'object' && error !== null && 'status' in error ? error.status : null
        throw new NoticeFailure(
          status === 403 || status === 404 ? 'permanent' : 'transient',
          'Discord authorization lookup failed before send',
        )
      }
    },
    send: async (origin, reply) => {
      let channel: Awaited<ReturnType<typeof channelFor>>
      try {
        channel = await channelFor(origin)
      } catch (error) {
        reportError('notices.revalidate', error, { channelId: origin.channelId })
        const status =
          typeof error === 'object' && error !== null && 'status' in error ? error.status : null
        throw new NoticeFailure(
          status === 403 || status === 404 ? 'permanent' : 'transient',
          'Discord revalidation lookup failed before send',
        )
      }
      if (!channel) throw new NoticeFailure('permanent', 'permission revoked before send')
      try {
        await channel.send(reply)
      } catch (error) {
        reportError('notices.send', error, { channelId: origin.channelId })
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
