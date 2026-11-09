import type { Message } from 'discord.js'
import type { Invocation } from '../../core/conversation/invocation'

type MessageEvent = Pick<
  Message,
  'id' | 'guildId' | 'channelId' | 'createdTimestamp' | 'content'
> & {
  author: Pick<Message['author'], 'id' | 'username' | 'bot'>
  attachments: ReadonlyMap<string, Invocation['attachments'][number]>
}

type Attachment = Invocation['attachments'][number]

/**
 * A reply that brings no attachments of its own uses the images of the message it answers
 * («@Gnomo guarda este meme» as a reply). Only what the image verifier accepts: anything else
 * (GIF, video, oversized) would fail the whole request instead of being ignored.
 */
export function referencedImages(attachments: Iterable<Attachment>): Attachment[] {
  return [...attachments]
    .filter(
      (attachment) =>
        ['image/png', 'image/jpeg', 'image/webp'].includes(
          attachment.contentType?.toLowerCase().split(';')[0].trim() ?? '',
        ) && attachment.size <= 2_500_000,
    )
    .slice(0, 2)
}

export function normalizeInvocation(
  event: MessageEvent,
  allowedGuildId: string | undefined,
  botId: string | undefined,
  referenced: Attachment[] = [],
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
    attachments: [...(event.attachments.size ? event.attachments.values() : referenced)].map(
      ({ id, url, name, contentType, size }) => ({ id, url, name, contentType, size }),
    ),
  }
}
