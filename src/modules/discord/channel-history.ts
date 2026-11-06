import { readBoundedBody } from '../../web/bounded-body'
import type { Client } from 'discord.js'
import { z } from 'zod'
import type { Invocation } from '../../core/conversation/invocation'
import type { HistoryReader, HistoryResult } from '../../conversation/channel-history'

const discordMessage = z.object({
  id: z.string(),
  channel_id: z.string(),
  author: z.object({ id: z.string(), username: z.string() }),
  content: z.string(),
  timestamp: z.iso.datetime({ offset: true }),
})

/** Native fetch has no hidden SDK retries; every page shares the invocation budget. */
export function discordHistory(
  client: Client,
  authorize: (invocation: Invocation, signal?: AbortSignal) => Promise<boolean>,
  fetcher: typeof fetch = fetch,
  cacheEnabled = true,
): HistoryReader {
  // Short lived request-page cache, never an ambient archive. Fixed expiry is not renewed on hits.
  const cache = new Map<
    string,
    { expires: number; value: HistoryResult; timer: ReturnType<typeof setTimeout> }
  >()
  return async (context, limit) => {
    const { invocation, signal } = context
    signal.throwIfAborted()
    if (!(await authorize(invocation, signal))) throw new Error('History permission denied')
    const key = JSON.stringify([
      invocation.guildId,
      invocation.channelId,
      invocation.messageId,
      limit,
    ])
    const cached = cache.get(key)
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value)
    if (cached) {
      clearTimeout(cached.timer)
      cache.delete(key)
    }
    const result: HistoryResult = {
      source: 'discord',
      channelId: invocation.channelId,
      fetchedAt: Date.now(),
      requested: limit,
      messages: [],
      partial: false,
      limits:
        'Máximo 200 mensajes, dos páginas de 100 y 14000 caracteres JSON; contenido por mensaje hasta 2000 caracteres. Cobertura limitada al canal actual y anterior a la invocación.',
    }
    let before = invocation.messageId
    const seen = new Set([before])
    for (let page = 0; page < Math.ceil(limit / 100); page++) {
      signal.throwIfAborted()
      if (!(await authorize(invocation, signal))) throw new Error('History permission denied')
      signal.throwIfAborted()
      const size = Math.min(100, limit - page * 100)
      const url = new URL(
        `https://discord.com/api/v10/channels/${encodeURIComponent(invocation.channelId)}/messages`,
      )
      url.searchParams.set('limit', String(size))
      url.searchParams.set('before', before)
      try {
        const data = await context.external(async () => {
          const response = await fetcher(url, {
            signal,
            headers: { Authorization: `Bot ${client.token}` },
          })
          if (!response.ok || !response.body) throw new Error('Discord history unavailable')
          const bytes = await readBoundedBody(response.body, 1000000, signal)
          return z
            .array(discordMessage)
            .max(100)
            .parse(JSON.parse(bytes.toString('utf8')))
        })
        for (const message of data) {
          if (message.channel_id !== invocation.channelId || seen.has(message.id)) continue
          seen.add(message.id)
          result.partial ||= message.content.length > 2000
          result.messages.push({
            messageId: message.id,
            channelId: message.channel_id,
            author: message.author,
            content: message.content.slice(0, 2000),
            createdAt: Date.parse(message.timestamp),
          })
        }
        if (data.length < size) break
        const cursor = data.at(-1)?.id
        if (!cursor || cursor === before) {
          result.partial = true
          break
        }
        before = cursor
      } catch (error) {
        if (!result.messages.length || signal.aborted) throw error
        result.partial = true
        break
      }
    }
    result.messages = result.messages.slice(0, limit)
    while (JSON.stringify(result).length > 14000) {
      result.messages.pop()
      result.partial = true
    }
    result.messages.reverse()
    if (cacheEnabled && !signal.aborted) {
      while (cache.size >= 16) {
        const oldest = cache.keys().next().value!
        clearTimeout(cache.get(oldest)!.timer)
        cache.delete(oldest)
      }
      const timer = setTimeout(() => cache.delete(key), 10000)
      timer.unref()
      cache.set(key, { expires: Date.now() + 10000, value: structuredClone(result), timer })
    }
    return result
  }
}
