export interface Memory {
  id: string
  key: string | null
  content: string
  embedding: number[] | null
  category: string
  guildId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface SaveMemoryOptions {
  key?: string
  category?: string
  guildId?: string
}

export interface SearchMemoryOptions {
  limit?: number
  category?: string
  guildId?: string
  threshold?: number
}

export interface MemorySearchResult {
  memory: Memory
  similarity: number
}

export type MemoryCategory = 'users' | 'preferences' | 'facts' | 'events' | 'general'
