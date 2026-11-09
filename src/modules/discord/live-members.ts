import { GatewayIntentBits, PermissionFlagsBits, type Client } from 'discord.js'
import type { LiveMembers } from '../../conversation/live-members'
import type { MemberDirectory } from '../../conversation/member-directory'
import { reportError } from '../../diagnostics'

/** Shown to the model with live results; shared by all transports. */
export const PRESENCE_NOTE =
  'Observaciones de caché al consultar, sin fecha de evento garantizada ni censo completo. Invisible no se puede detectar; offline solo aparece desconectado. Datos ausentes son desconocidos. No se infiere de mensajes ni voz.'
export const VOICE_NOTE =
  'Caché de voz al consultar, sin fecha de evento garantizada. Solo canales visibles; cobertura parcial, no confirma ausencia de llamada ni presencia en línea.'

/** Gateway cache observations are never a complete census or a REST presence snapshot. */
export function discordLiveMembers(client: Client, members: MemberDirectory): LiveMembers {
  return {
    async presence(context, limit, after) {
      const page = await members.list(context, limit, after)
      const guild = client.guilds.cache.get(context.invocation.guildId)
      const usable =
        client.isReady() &&
        guild?.available &&
        client.options.intents.has(GatewayIntentBits.GuildPresences)
      let observed = 0
      const rows = page.members.map<
        Awaited<ReturnType<LiveMembers['presence']>>['members'][number]
      >((member) => {
        const raw = usable ? guild.presences.cache.get(member.id)?.status : undefined
        const status =
          raw === 'online' || raw === 'idle' || raw === 'dnd' || raw === 'offline' ? raw : 'unknown'
        if (status !== 'unknown') observed++
        return {
          ...member,
          status,
          connected: status === 'unknown' ? null : status !== 'offline',
          label:
            status === 'offline'
              ? 'aparece desconectado'
              : status === 'unknown'
                ? 'presencia desconocida'
                : status,
        }
      })
      return {
        members: rows,
        coverage: observed ? 'partial' : 'unknown',
        memberCoverage: page.coverage,
        fromAfter: page.fromAfter,
        nextAfter: page.nextAfter,
        queriedAt: new Date().toISOString(),
        source: 'discord-gateway',
        note: PRESENCE_NOTE,
      }
    },
    async voice(context, limit, after) {
      const empty = {
        participants: [],
        coverage: 'unknown' as const,
        memberCoverage: 'unknown' as const,
        fromAfter: after ?? null,
        nextAfter: null,
        queriedAt: new Date().toISOString(),
        source: 'discord-gateway' as const,
        note: VOICE_NOTE,
      }
      const guild = client.guilds.cache.get(context.invocation.guildId)
      if (
        !client.isReady() ||
        !guild?.available ||
        !client.user ||
        !client.options.intents.has(GatewayIntentBits.GuildVoiceStates)
      )
        return empty
      try {
        const page = await members.list(context, limit, after)
        if (page.coverage === 'unknown') return empty
        const requester = await context.external(() =>
          guild.members.fetch({ user: context.invocation.requester.id, force: true }),
        )
        const bot = await context.external(() =>
          guild.members.fetch({ user: client.user!.id, force: true }),
        )
        const channels = await context.external(() => guild.channels.fetch())
        context.signal.throwIfAborted()
        if (!client.isReady() || !guild.available) return empty
        const participants = page.members.flatMap((member) => {
          const channelId = guild.voiceStates.cache.get(member.id)?.channelId
          const channel = channelId ? channels.get(channelId) : null
          if (
            !channel?.isVoiceBased() ||
            !channel.permissionsFor(requester)?.has(PermissionFlagsBits.ViewChannel) ||
            !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel)
          )
            return []
          return [{ ...member, channel: { id: channel.id, name: channel.name } }]
        })
        return {
          ...empty,
          participants,
          coverage: 'partial',
          memberCoverage: page.coverage,
          fromAfter: page.fromAfter,
          nextAfter: page.nextAfter,
          queriedAt: new Date().toISOString(),
        }
      } catch (error) {
        context.signal.throwIfAborted()
        reportError('discord.voice', error, { invocationId: context.invocation.messageId })
        return empty
      }
    },
  }
}
