import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { ConversationPlatform } from '../../conversation/composition'
import type { HistoryResult } from '../../conversation/channel-history'
import type { MemberPage } from '../../conversation/member-directory'
import type { Invocation } from '../../core/conversation/invocation'
import type { SafeReader } from '../../web/safe-reader'
import { HISTORY_LIMITS } from '../discord/channel-history'
import { PRESENCE_NOTE, VOICE_NOTE } from '../discord/live-members'

export interface ConsoleIdentity {
  id: string
  username: string
}
export type ChannelMessage = HistoryResult['messages'][number]
export type ConsoleEvent =
  | { type: 'typing'; channelId: string }
  | { type: 'reply'; channelId: string; content: string; mentions: string[]; files?: string[] }
  | { type: 'scheduled'; channelId: string; content: string; kind: 'reminder' | 'birthday' }
  | { type: 'ignored'; reason: string }
  | { type: 'error'; message: string }

/** Fixed local snowflakes (17–20 digits, as the birthday/memory validators require). */
export const CONSOLE_DEFAULTS = {
  guildId: '100000000000000001',
  channelId: '100000000000000002',
  botId: '100000000000000003',
  userId: '100000000000000004',
} as const
const snowflake = /^\d{17,20}$/
const DISCORD_EPOCH = 1420070400000n

/**
 * The local stand-in for a Discord guild: one transcript per channel (user lines and bot replies),
 * a member roster and attachment bytes. Only this state differs from production; every tool still
 * runs through the shared composition with the same limits, notes and schemas.
 */
@Injectable()
export class ConsoleSession {
  readonly guildId: string
  readonly bot: ConsoleIdentity
  requester: ConsoleIdentity
  channelId: string
  /** Set by the terminal; events before that are discarded. */
  output: (event: ConsoleEvent) => void = () => undefined
  private readonly transcripts = new Map<string, ChannelMessage[]>()
  private readonly roster = new Map<string, ConsoleIdentity>()
  private readonly active = new Set<string>()
  private readonly files = new Map<string, { bytes: Buffer; contentType: string }>()
  private sequence = 0n
  private lastId = 0n

  constructor(config: ConfigService) {
    const get = (key: string) => config.get<string>(key)?.trim() || undefined
    this.guildId = get('GUILD_ID') ?? CONSOLE_DEFAULTS.guildId
    this.bot = {
      id: get('SANDBOX_BOT_ID') ?? CONSOLE_DEFAULTS.botId,
      username: get('SANDBOX_BOT_USERNAME') ?? 'Gnomo',
    }
    this.requester = {
      id: get('SANDBOX_USER_ID') ?? get('MEMORY_OWNER_ID') ?? CONSOLE_DEFAULTS.userId,
      username: get('SANDBOX_USERNAME') ?? 'console',
    }
    const pilotChannel =
      get('RUNTIME_MODE') === 'pilot'
        ? get('RUNTIME_CHANNEL_IDS')
            ?.split(',')
            .map((id) => id.trim())
            .find(Boolean)
        : undefined
    this.channelId =
      get('SANDBOX_CHANNEL_ID') ??
      pilotChannel ??
      get('GNOMOS_CHANNEL_ID') ??
      CONSOLE_DEFAULTS.channelId
    for (const entry of (get('SANDBOX_MEMBERS') ?? '').split(',')) {
      const [id, ...name] = entry.trim().split(':')
      if (id && snowflake.test(id) && name.join(':').trim())
        this.roster.set(id, { id, username: name.join(':').trim() })
    }
    this.roster.set(this.bot.id, this.bot)
    this.setRequester(this.requester)
  }

  setRequester(identity: ConsoleIdentity) {
    if (!snowflake.test(identity.id)) throw new Error('El ID de usuario debe tener 17–20 dígitos')
    this.requester = { ...identity }
    this.roster.set(identity.id, this.requester)
  }
  identity(id: string): ConsoleIdentity | undefined {
    return this.roster.get(id)
  }
  members(): ConsoleIdentity[] {
    return [...this.roster.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
  }

  /** Discord-shaped, strictly increasing message IDs so "before" pagination behaves the same. */
  nextId(now = Date.now()): string {
    let id = ((BigInt(now) - DISCORD_EPOCH) << 22n) | (this.sequence++ & 0xfffn)
    if (id <= this.lastId) id = this.lastId + 1n
    this.lastId = id
    return String(id)
  }

  /** A message now visible in the channel, exactly as Discord history would later return it. */
  post(author: ConsoleIdentity, content: string, channelId = this.channelId): ChannelMessage {
    const createdAt = Date.now()
    const message: ChannelMessage = {
      messageId: this.nextId(createdAt),
      channelId,
      author: { id: author.id, username: author.username },
      content,
      createdAt,
    }
    const transcript = this.transcripts.get(channelId) ?? []
    transcript.push(message)
    // Discord history is capped at 200 by the reader; keep a little more for /history.
    this.transcripts.set(channelId, transcript.slice(-500))
    if (author.id !== this.bot.id) this.active.add(author.id)
    return message
  }
  transcript(channelId = this.channelId): readonly ChannelMessage[] {
    return this.transcripts.get(channelId) ?? []
  }
  reset(channelId = this.channelId) {
    this.transcripts.delete(channelId)
  }

  /** Registers local bytes behind a URL only this session's reader serves. */
  attach(name: string, bytes: Buffer, contentType: string): Invocation['attachments'][number] {
    const id = this.nextId()
    const url = `https://console.local/attachments/${id}/${encodeURIComponent(name)}`
    this.files.set(url, { bytes, contentType })
    return { id, url, name, contentType, size: bytes.length }
  }
  release(attachments: Invocation['attachments']) {
    for (const attachment of attachments) this.files.delete(attachment.url)
  }

  /** The production reader, except that console attachments come from local bytes. */
  web(reader: SafeReader): SafeReader {
    return {
      read: async (url, context, policy) => {
        const file = this.files.get(url)
        if (!file) return reader.read(url, context, policy)
        context.signal.throwIfAborted()
        if (!policy.types.includes(file.contentType)) return { status: 'unsupported', url }
        return {
          status: file.bytes.length > policy.maxBytes ? 'partial' : 'complete',
          bytes: file.bytes.subarray(0, policy.maxBytes),
          url,
          requestedUrl: url,
          contentType: file.contentType,
          retrievedAt: new Date().toISOString(),
        }
      },
    }
  }

  platform(): ConversationPlatform {
    const memberPage = (limit: number, after?: string): MemberPage => {
      const rows = this.members()
        .filter((member) => !after || BigInt(member.id) > BigInt(after))
        .slice(0, limit)
      return {
        members: rows.map((member) => ({
          id: member.id,
          username: member.username,
          displayName: null,
          nickname: null,
        })),
        coverage: rows.length === limit ? 'partial' : 'complete',
        fromAfter: after ?? null,
        nextAfter: rows.length === limit ? rows.at(-1)!.id : null,
        source: 'discord-rest',
        queriedAt: new Date().toISOString(),
      }
    }
    return {
      // The terminal user is always a member of the channel they type into.
      access: async (_invocation, signal) => {
        signal?.throwIfAborted()
        return true
      },
      members: {
        list: async (context, limit, after) => {
          context.signal.throwIfAborted()
          return memberPage(limit, after)
        },
        detail: async (context, id) => {
          context.signal.throwIfAborted()
          const member = this.roster.get(id)
          return {
            member: member
              ? { id: member.id, username: member.username, displayName: null, nickname: null }
              : null,
            coverage: 'complete',
            source: 'discord-rest',
            queriedAt: new Date().toISOString(),
          }
        },
      },
      live: {
        presence: async (context, limit, after) => {
          context.signal.throwIfAborted()
          const page = memberPage(limit, after)
          let observed = 0
          const members = page.members.map((member) => {
            // Whoever typed in this session (and the bot) is online; nobody else is observed.
            const online = member.id === this.bot.id || this.active.has(member.id)
            if (online) observed++
            return {
              ...member,
              status: online ? ('online' as const) : ('unknown' as const),
              connected: online ? true : null,
              label: online ? 'online' : 'presencia desconocida',
            }
          })
          return {
            members,
            coverage: observed ? 'partial' : 'unknown',
            memberCoverage: page.coverage,
            fromAfter: page.fromAfter,
            nextAfter: page.nextAfter,
            queriedAt: new Date().toISOString(),
            source: 'discord-gateway',
            note: PRESENCE_NOTE,
          }
        },
        voice: async (context, _limit, after) => {
          context.signal.throwIfAborted()
          return {
            participants: [],
            coverage: 'unknown',
            memberCoverage: 'unknown',
            fromAfter: after ?? null,
            nextAfter: null,
            queriedAt: new Date().toISOString(),
            source: 'discord-gateway',
            note: VOICE_NOTE,
          }
        },
      },
      // Same contract as the Discord reader: messages strictly before the invocation, newest
      // `limit`, 2000 chars per message, 14000 JSON chars, oldest dropped first.
      history: (authorize) => async (context, limit) => {
        const { invocation, signal } = context
        signal.throwIfAborted()
        if (!(await authorize(invocation, signal))) throw new Error('History permission denied')
        const before = BigInt(invocation.messageId)
        const result: HistoryResult = {
          source: 'discord',
          channelId: invocation.channelId,
          fetchedAt: Date.now(),
          requested: limit,
          messages: [],
          partial: false,
          limits: HISTORY_LIMITS,
        }
        const newestFirst = this.transcript(invocation.channelId)
          .filter((message) => BigInt(message.messageId) < before)
          .reverse()
          .slice(0, Math.min(limit, 200))
        for (const message of newestFirst) {
          result.partial ||= message.content.length > 2000
          result.messages.push({ ...message, content: message.content.slice(0, 2000) })
        }
        while (JSON.stringify(result).length > 14000) {
          result.messages.pop()
          result.partial = true
        }
        result.messages.reverse()
        return result
      },
    }
  }
}
