import type { Guild } from 'discord.js'
import type { MemorySearchResult } from '../../modules/services/memory/memory.types'

export interface ImageAttachment {
  url: string
  name: string
  contentType: string
}

export interface MessageHistory {
  role: 'user' | 'assistant'
  username: string
  userId: string
  content: string
  timestamp: number
  images?: ImageAttachment[]
}

export interface UserInfo {
  username: string
  userId: string
}

export interface BotContext {
  message: string
  userInfo: UserInfo
  channel: { id: string }
  guildId: string
  images: ImageAttachment[]
  history: MessageHistory[]
  guild: Guild
  enrichedMemories?: MemorySearchResult[]
}
