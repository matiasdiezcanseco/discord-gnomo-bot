import type { Message } from 'discord.js'
import type { Invocation } from '../../core/conversation/invocation'

type MessageEvent = Pick<
  Message,
  'id' | 'guildId' | 'channelId' | 'createdTimestamp' | 'content'
> & {
  author: Pick<Message['author'], 'id' | 'username' | 'bot'>
  attachments: ReadonlyMap<string, Invocation['attachments'][number]>
}

export function normalizeInvocation(
  event: MessageEvent,
  allowedGuildId: string | undefined,
  botId: string | undefined,
): Invocation | null {
  if (!allowedGuildId || !botId || event.author.bot || event.guildId !== allowedGuildId) return null
  const mentions = [...event.content.matchAll(/<@!?(\d+)>/g)]
  if (!mentions.some((match) => match[1] === botId)) return null
  return {
    messageId: event.id,
    guildId: allowedGuildId,
    channelId: event.channelId,
    requester: { id: event.author.id, username: event.author.username },
    content: event.content
      .replace(/<@!?(\d+)>/g, (mention, id) => (id === botId ? '' : mention))
      .trim(),
    createdAt: event.createdTimestamp,
    attachments: [...event.attachments.values()].map(({ id, url, name, contentType, size }) => ({
      id,
      url,
      name,
      contentType,
      size,
    })),
  }
}
