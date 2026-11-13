import type { Client } from 'discord.js'
import { z } from 'zod'
import type { Invocation } from '../../core/conversation/invocation'
import type { ExecutionContext } from '../../conversation/catalog'
import type { Reactions } from '../../conversation/reactions'
import { readBoundedBody } from '../../web/bounded-body'

const guildEmojis = z.array(
  z.object({
    id: z.string(),
    name: z.string().nullable(),
    animated: z.boolean().optional(),
    available: z.boolean().optional(),
    roles: z.array(z.string()).optional(),
  }),
)

/** No hidden retries: every REST request shares the invocation's budget and cancellation. */
export function discordReactions(
  client: Client,
  authorize: (invocation: Invocation, signal?: AbortSignal) => Promise<boolean>,
  fetcher: typeof fetch = fetch,
): Reactions {
  async function check(context: ExecutionContext) {
    context.signal.throwIfAborted()
    if (!(await authorize(context.invocation, context.signal)))
      throw new Error('Reaction permission denied')
    context.signal.throwIfAborted()
  }
  return {
    async list(context, query) {
      await check(context)
      const guild = await client.guilds.fetch(context.invocation.guildId)
      if (!client.user) throw new Error('Discord unavailable')
      const bot = await guild.members.fetch({ user: client.user.id })
      await check(context)
      const emojis = await context.external(async () => {
        const response = await fetcher(
          `https://discord.com/api/v10/guilds/${encodeURIComponent(context.invocation.guildId)}/emojis`,
          { signal: context.signal, headers: { Authorization: `Bot ${client.token}` } },
        )
        if (!response.ok || !response.body)
          throw new Error(`Discord emojis unavailable: HTTP ${response.status}`)
        return guildEmojis.parse(
          JSON.parse(
            (await readBoundedBody(response.body, 1000000, context.signal)).toString('utf8'),
          ),
        )
      })
      const result = {
        emojis: emojis
          .filter(
            (emoji) =>
              emoji.name &&
              emoji.available !== false &&
              (!emoji.roles?.length || emoji.roles.some((role) => bot.roles.cache.has(role))) &&
              (!query || emoji.name.toLowerCase().includes(query.toLowerCase())),
          )
          .map((emoji) => ({
            emoji: `${emoji.name}:${emoji.id}`,
            name: emoji.name!,
            animated: emoji.animated ?? false,
          })),
        partial: false,
      }
      while (JSON.stringify(result).length > 14000) {
        result.emojis.pop()
        result.partial = true
      }
      return result
    },
    async add(context, messageId, emoji) {
      if (!/^\d{1,20}$/.test(messageId)) throw new Error('Invalid message ID')
      const normalized = emoji.replace(/^<a?:([A-Za-z0-9_]+:\d+)>$/, '$1')
      await check(context)
      await context.external(async () => {
        context.signal.throwIfAborted()
        const response = await fetcher(
          `https://discord.com/api/v10/channels/${encodeURIComponent(context.invocation.channelId)}/messages/${messageId}/reactions/${encodeURIComponent(normalized)}/@me`,
          {
            method: 'PUT',
            signal: context.signal,
            headers: { Authorization: `Bot ${client.token}` },
          },
        )
        if (response.status !== 204)
          throw new Error(`Discord reaction failed: HTTP ${response.status}`)
      })
    },
  }
}
