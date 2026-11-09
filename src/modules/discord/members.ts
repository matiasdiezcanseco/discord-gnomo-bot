import { GatewayIntentBits, type Client } from 'discord.js'
import { z } from 'zod'

import type { MemberDirectory, MemberPage } from '../../conversation/member-directory'
import { reportError } from '../../diagnostics'
const wireMember = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
    global_name: z.string().nullable().optional(),
  }),
  nick: z.string().nullable().optional(),
})

/** Fresh REST reads, never cache completeness. Reusable independently of presence and voice. */
export function discordMembers(client: Client, fetcher: typeof fetch = fetch): MemberDirectory {
  return {
    async detail(context, id) {
      const result: Awaited<ReturnType<MemberDirectory['detail']>> = {
        member: null,
        coverage: 'unknown',
        source: 'discord-rest',
        queriedAt: new Date().toISOString(),
      }
      try {
        return await context.external(async () => {
          const response = await fetcher(
            `https://discord.com/api/v10/guilds/${context.invocation.guildId}/members/${id}`,
            {
              headers: { Authorization: `Bot ${client.token}` },
              signal: context.signal,
            },
          )
          if (response.status === 404) return { ...result, coverage: 'complete' as const }
          if (!response.ok) return result
          const { user, nick } = wireMember.parse(await response.json())
          return {
            ...result,
            coverage: 'complete' as const,
            member: {
              id: user.id,
              username: user.username,
              displayName: user.global_name ?? null,
              nickname: nick ?? null,
            },
          }
        })
      } catch (error) {
        context.signal.throwIfAborted()
        reportError('discord.members.detail', error, { invocationId: context.invocation.messageId })
        return result
      }
    },
    async list(context, limit, after) {
      const result: MemberPage = {
        members: [],
        coverage: 'unknown',
        fromAfter: after ?? null,
        nextAfter: null,
        source: 'discord-rest',
        queriedAt: new Date().toISOString(),
      }
      if (!client.options.intents.has(GatewayIntentBits.GuildMembers)) return result
      const query = new URLSearchParams({ limit: String(limit), ...(after ? { after } : {}) })
      try {
        const rows = await context.external(async () => {
          const response = await fetcher(
            `https://discord.com/api/v10/guilds/${context.invocation.guildId}/members?${query}`,
            {
              headers: { Authorization: `Bot ${client.token}` },
              signal: context.signal,
            },
          )
          if (!response.ok) throw new Error(`Member lookup unavailable: HTTP ${response.status}`)
          return z
            .array(wireMember)
            .max(limit)
            .parse(await response.json())
        })
        result.members = rows.map(({ user, nick }) => ({
          id: user.id,
          username: user.username,
          displayName: user.global_name ?? null,
          nickname: nick ?? null,
        }))
        result.coverage = rows.length === limit ? 'partial' : 'complete'
        result.nextAfter = rows.length === limit ? rows.at(-1)!.user.id : null
      } catch (error) {
        context.signal.throwIfAborted()
        reportError('discord.members.list', error, { invocationId: context.invocation.messageId })
      }
      return result
    },
  }
}
