import type { MemberDirectory } from '../conversation/member-directory'
import type { HistoryResult } from '../conversation/channel-history'
import type { LiveMembers } from '../conversation/live-members'
import type { CollectionSource } from '../conversation/collection-content'
import type { PublicSearch } from '../conversation/public-search'

export const sandboxUsers = {
  tester: { id: '900000000000000001', username: 'Tester' },
  ana: { id: '900000000000000002', username: 'Ana' },
  bruno: { id: '900000000000000003', username: 'Bruno' },
} as const
export const sandboxChannels = {
  general: '900000000000000010',
  juegos: '900000000000000011',
} as const
export type SandboxUser = keyof typeof sandboxUsers
export type SandboxChannel = keyof typeof sandboxChannels

const members = Object.values(sandboxUsers).map((user) => ({
  ...user,
  displayName: `${user.username} (sandbox)`,
  nickname: null,
}))
export const fixtureMembers: MemberDirectory = {
  async list(context, limit, after) {
    context.signal.throwIfAborted()
    const remaining = members.filter((m) => !after || BigInt(m.id) > BigInt(after))
    const page = remaining.slice(0, limit)
    return {
      members: structuredClone(page),
      coverage: remaining.length > limit ? 'partial' : 'complete',
      fromAfter: after ?? null,
      nextAfter: remaining.length > limit ? page.at(-1)!.id : null,
      source: 'discord-rest',
      queriedAt: new Date().toISOString(),
    }
  },
  async detail(context, id) {
    context.signal.throwIfAborted()
    return {
      member: structuredClone(members.find((m) => m.id === id) ?? null),
      coverage: 'complete',
      source: 'discord-rest',
      queriedAt: new Date().toISOString(),
    }
  },
}
export const fixtureLive: LiveMembers = {
  async presence(context, limit, after) {
    const page = await fixtureMembers.list(context, limit, after)
    return {
      ...page,
      source: 'discord-gateway',
      coverage: 'partial',
      memberCoverage: page.coverage,
      note: 'SANDBOX FIXTURE; no Discord connection. Invisible cannot be distinguished.',
      members: page.members.map((m) => ({
        ...m,
        status: m.username === 'Bruno' ? 'unknown' : 'online',
        connected: m.username === 'Bruno' ? null : true,
        label: 'sandbox fixture',
      })),
    }
  },
  async voice(context, limit, after) {
    const page = await fixtureMembers.list(context, limit, after)
    const { members: pageMembers, ...metadata } = page
    return {
      ...metadata,
      source: 'discord-gateway',
      coverage: 'partial',
      memberCoverage: page.coverage,
      note: 'SANDBOX FIXTURE; voice is separate from presence.',
      participants: pageMembers
        .filter((m) => m.username === 'Ana')
        .map((m) => ({ ...m, channel: { id: '900000000000000020', name: 'Sala sandbox' } })),
    }
  },
}
export const fixtureCollection: CollectionSource = {
  read: async (file) =>
    file === 'phrases.json'
      ? ['Frase del sandbox: aquí nadie recibe notificaciones.']
      : ['photo.png'],
  photoUrl: (path) => `https://sandbox.invalid/${path}`,
}
export function fixtureHistory(channelId: string): HistoryResult['messages'] {
  return [
    {
      messageId: `seed-${channelId}`,
      channelId,
      author: { ...sandboxUsers.ana },
      content: 'Mensaje de Ana en el sandbox. Datos ficticios.',
      createdAt: Date.now() - 60000,
    },
  ]
}

export const fixtureSearch: PublicSearch = {
  async search(_query, context, period) {
    context.signal.throwIfAborted()
    return {
      outcome: 'ok',
      message: 'SANDBOX FIXTURE; not live news.',
      provider: 'tavily',
      consultedAt: new Date().toISOString(),
      period: period ?? null,
      reused: false,
      sources: [
        {
          title: 'Torneo ficticio del sandbox',
          url: 'https://sandbox.invalid/news',
          content: 'Ana ganó un torneo ficticio. No es una noticia real.',
          publishedAt: null,
          eventDate: null,
        },
      ],
      coverage: {
        exhaustive: false,
        limited: true,
        omitted: 0,
        periodBasis: 'publication',
        note: 'SANDBOX FIXTURE; Tavily was not contacted.',
      },
    }
  },
}
