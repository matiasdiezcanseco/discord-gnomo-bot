import { createHash, randomUUID } from 'node:crypto'
import type Redis from 'ioredis'
import type { Invocation } from '../core/conversation/invocation'
import {
  createConversation,
  type ConversationPorts,
  type Reply,
  type Trace,
} from '../conversation/harness'
import { composeCapabilities } from '../conversation/capabilities'
import { capabilityAllowed } from '../conversation/execution-policy'
import { memoryCapabilities, type MemoryDependencies } from '../conversation/explicit-memory'
import { memberMentions } from '../conversation/member-mentions'
import { redisClaims } from '../conversation/redis-claims'
import { ScheduledNotices, type ScheduledOrigin } from '../conversation/scheduled-notices'
import type { HistoryResult, HistoryReader } from '../conversation/channel-history'
import type { ReaderNetwork } from '../web/safe-reader'
import type { PublicSearch } from '../conversation/public-search'
import { sandboxReader } from './network'
import { attachedImages } from '../conversation/attached-images'
import type { SafeReader } from '../web/safe-reader'
import { limaDate, scheduleBirthdays } from '../conversation/birthdays'
import { fixtureModel } from './fixture-model'
import {
  sandboxChannels,
  sandboxUsers,
  fixtureCollection,
  fixtureMembers,
  fixtureLive,
  fixtureHistory,
  fixtureSearch,
  type SandboxUser,
  type SandboxChannel,
} from './fixtures'

export interface SandboxOptions {
  session?: string
  model?: ConversationPorts['model']
  memory?: MemoryDependencies
  redis?: Redis
  liveWeb?: boolean
  network?: ReaderNetwork
  search?: PublicSearch
}
export interface SandboxQuery {
  user?: SandboxUser
  channel?: SandboxChannel
  messageId?: string
  images?: { name: string; contentType: string; bytes: Uint8Array }[]
}
export interface SandboxResult {
  invocation: Invocation
  replies: Reply[]
  traces: Trace[]
}

/** No Discord client, token, receiver or send transport is constructed or accepted. */
export function createSandbox(options: SandboxOptions = {}) {
  const session = options.session ?? 'default'
  if (!/^[a-z0-9_-]{1,40}$/.test(session)) throw new Error('Invalid sandbox session')
  const namespace = `gnomo:sandbox:${session}`
  const guildId = String(
    900000000000000000n +
      BigInt(`0x${createHash('sha256').update(session).digest('hex').slice(0, 12)}`),
  )
  const history = new Map<string, HistoryResult['messages']>()
  const captured = new Map<string, SandboxResult>()
  const claimed = new Set<string>()
  let permitted = true
  let offsetMs = 0
  const imageFiles = new Map<string, { bytes: Buffer; contentType: string }>()
  const web = sandboxReader(options.liveWeb, options.network)
  const reader: SafeReader = {
    async read(url, context, policy) {
      const image = imageFiles.get(url)
      if (!image) return web.read(url, context, policy)
      context.signal.throwIfAborted()
      if (!policy.types.includes(image.contentType)) return { status: 'unsupported', url }
      return {
        status: image.bytes.length > policy.maxBytes ? 'partial' : 'complete',
        bytes: image.bytes.subarray(0, policy.maxBytes),
        url,
        requestedUrl: url,
        contentType: image.contentType,
        retrievedAt: new Date().toISOString(),
      }
    },
  }
  const notices = options.redis
    ? new ScheduledNotices(options.redis, `${namespace}:notices`)
    : undefined
  const authorize: ConversationPorts['authorize'] = async (invocation, tool, signal) => {
    signal?.throwIfAborted()
    return (
      permitted &&
      invocation.guildId === guildId &&
      Object.values(sandboxChannels).some((id) => id === invocation.channelId) &&
      capabilityAllowed(invocation, tool)
    )
  }
  const loadHistory: HistoryReader = async ({ invocation, signal }, limit = 30) => {
    signal.throwIfAborted()
    const candidates = (history.get(invocation.channelId) ?? fixtureHistory(invocation.channelId))
      .filter((m) => m.messageId !== invocation.messageId)
      .slice(-limit)
    const messages: HistoryResult['messages'] = []
    let chars = 0
    for (const message of [...candidates].reverse()) {
      const item = { ...message, content: message.content.slice(0, 1000) }
      const size = JSON.stringify(item).length
      if (chars + size > 10000) break
      chars += size
      messages.unshift(item)
    }
    return {
      source: 'discord' as const,
      channelId: invocation.channelId,
      fetchedAt: Date.now(),
      requested: limit,
      messages,
      partial:
        messages.length < candidates.length || candidates.some((m) => m.content.length > 1000),
      limits: 'SANDBOX FIXTURES; local bounded history, no Discord queried.',
    }
  }
  const app = createConversation({
    model: options.model ?? fixtureModel,
    catalog: composeCapabilities({
      collection: fixtureCollection,
      members: fixtureMembers,
      live: fixtureLive,
      history: loadHistory,
      memory: memoryCapabilities(options.memory, sandboxUsers.tester.id, (invocation, signal) =>
        authorize(invocation, undefined, signal),
      ),
      notices,
      web: reader,
      search: options.liveWeb ? options.search : fixtureSearch,
    }),
    loadContext: (context) => loadHistory(context, 30),
    loadImages: attachedImages(reader),
    authorize,
    discover: async (invocation, tool) => capabilityAllowed(invocation, tool),
    claim: options.redis
      ? redisClaims(options.redis, `${namespace}:claims`)
      : async ({ messageId }) => {
          if (claimed.has(messageId)) return false
          claimed.add(messageId)
          return true
        },
    allowedUserMentions: memberMentions(fixtureMembers),
    trace: (event) => captured.get(event.invocationId)?.traces.push(event),
    reply: async (invocation, reply) => {
      captured.get(invocation.messageId)?.replies.push(reply)
    },
  })
  return {
    setPermission(allowed: boolean) {
      permitted = allowed
    },
    async birthdays() {
      if (!notices) return []
      const now = Date.now() + offsetMs
      return scheduleBirthdays(
        now,
        { guildId, channelId: sandboxChannels.general },
        async () => [
          { id: sandboxUsers.ana.id, name: 'Ana (sandbox)', date: limaDate(now).slice(5) },
        ],
        notices,
      )
    },
    async advance(seconds: number) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 31_536_000)
        throw new Error('Invalid sandbox time advance')
      offsetMs += seconds * 1000
      const delivered: { origin: ScheduledOrigin; reply: Reply }[] = []
      await notices?.dispatch(Date.now() + offsetMs, {
        admits: (origin) => origin.guildId === guildId,
        authorize: async (origin) =>
          permitted &&
          origin.guildId === guildId &&
          Object.values(sandboxChannels).some((id) => id === origin.channelId),
        send: async (origin, reply) => {
          delivered.push({ origin, reply })
        },
      })
      return delivered
    },
    async ask(content: string, query: SandboxQuery = {}): Promise<SandboxResult> {
      const requester = sandboxUsers[query.user ?? 'tester']
      const channelId = sandboxChannels[query.channel ?? 'general']
      if (!requester || !channelId || !content.trim() || content.length > 8000)
        throw new Error('Invalid sandbox query')
      if (query.messageId && captured.has(query.messageId))
        throw new Error('Sandbox event already running')
      if (
        (query.images?.length ?? 0) > 2 ||
        query.images?.some((image) => image.bytes.length > 2_500_000)
      )
        throw new Error('Sandbox image limits exceeded')
      const attachments = (query.images ?? []).map((image) => {
        const id = randomUUID(),
          url = `https://sandbox.invalid/attachment/${id}`
        const bytes = Buffer.from(image.bytes)
        imageFiles.set(url, { bytes, contentType: image.contentType })
        return { id, url, name: image.name, contentType: image.contentType, size: bytes.length }
      })
      const invocation: Invocation = {
        guildId,
        channelId,
        messageId: query.messageId ?? randomUUID(),
        requester: { ...requester },
        content,
        createdAt: Date.now() + offsetMs,
        attachments,
      }
      const result: SandboxResult = { invocation, replies: [], traces: [] }
      captured.set(invocation.messageId, result)
      try {
        await app.handle(invocation)
        if (result.traces.some((t) => t.event === 'duplicate')) return result
        const messages = history.get(channelId) ?? fixtureHistory(channelId)
        messages.push({
          messageId: invocation.messageId,
          channelId,
          author: invocation.requester,
          content,
          createdAt: invocation.createdAt,
        })
        for (const reply of result.replies)
          messages.push({
            messageId: randomUUID(),
            channelId,
            author: { id: '900000000000000099', username: 'Gnomo sandbox' },
            content: reply.content,
            createdAt: Date.now(),
          })
        history.set(channelId, messages.slice(-200))
        return result
      } finally {
        captured.delete(invocation.messageId)
        for (const attachment of attachments) imageFiles.delete(attachment.url)
      }
    },
  }
}
