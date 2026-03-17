import { Injectable, Inject } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { LoggerService } from '../logger/logger.service'
import { DATABASE_TOKEN, type Db } from '../../database/database.module'
import type {
  Memory,
  SaveMemoryOptions,
  SearchMemoryOptions,
  MemorySearchResult,
} from './memory.types'
import { generateEmbedding } from './utils/embeddings'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined
}

@Injectable()
export class MemoryService {
  private enabled: boolean = false

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    @Inject(DATABASE_TOKEN) private readonly db: Db | null,
  ) {
    if (!this.db) {
      this.logger.warn('DATABASE_URL not configured - memory feature disabled', 'memory-service')
      return
    }

    this.enabled = true
    this.logger.info('Prisma memory client initialized', 'memory-service')
  }

  isEnabled(): boolean {
    return this.enabled
  }

  private ensureEnabled(): boolean {
    return this.enabled && !!this.db
  }

  private logError(operation: string, error: unknown): void {
    this.logger.error(
      `Failed to ${operation}: ${getErrorMessage(error)}`,
      'memory-service',
      getErrorStack(error),
    )
  }

  private mapRowToMemory(row: {
    id: string
    key: string | null
    content: string
    embedding?: string | null
    category: string | null
    guildId: string | null
    createdAt: Date
    updatedAt: Date
  }): Memory {
    let embedding: number[] | null = null
    if (row.embedding) {
      try {
        embedding = JSON.parse(row.embedding)
      } catch {
        embedding = null
      }
    }

    return {
      id: row.id,
      key: row.key,
      content: row.content,
      embedding,
      category: row.category ?? 'general',
      guildId: row.guildId,
      createdAt: row.createdAt ?? new Date(),
      updatedAt: row.updatedAt ?? new Date(),
    }
  }

  private buildEnhancedEmbeddingText(content: string, options: SaveMemoryOptions): string {
    const parts: string[] = [content]

    if (options.key) {
      parts.push(`clave: ${options.key}`)
    }

    if (options.category) {
      parts.push(`categoría: ${options.category}`)
    }

    return parts.join('. ')
  }

  async saveMemory(content: string, options: SaveMemoryOptions = {}): Promise<Memory | null> {
    if (!this.ensureEnabled()) {
      this.logger.warn('Memory service not enabled, skipping save', 'memory-service')
      return null
    }

    try {
      const textForEmbedding = this.buildEnhancedEmbeddingText(content, options)
      const embedding = await generateEmbedding(textForEmbedding, this.config)
      const embeddingStr = JSON.stringify(embedding)
      const id = crypto.randomUUID()
      const key = options.key || null
      const category = options.category || 'general'
      const guildId = options.guildId || null

      const rows = await this.db!.$queryRawUnsafe<
        Array<{
          id: string
          key: string | null
          content: string
          category: string
          guild_id: string | null
          created_at: Date
          updated_at: Date
        }>
      >(
        `INSERT INTO memories (id, key, content, embedding, category, guild_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4::vector, $5, $6, NOW(), NOW())
         RETURNING id, key, content, category, guild_id, created_at, updated_at`,
        id,
        key,
        content,
        embeddingStr,
        category,
        guildId,
      )

      const row = rows[0]
      if (!row) {
        this.logger.error('Failed to insert memory', 'memory-service')
        return null
      }

      this.logger.info(`Memory saved: ${options.key || 'auto'} (id=${row.id})`, 'memory-service')
      return this.mapRowToMemory({
        id: row.id,
        key: row.key,
        content: row.content,
        embedding: null,
        category: row.category,
        guildId: row.guild_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
    } catch (error) {
      this.logError('save memory', error)
      return null
    }
  }

  async updateMemory(key: string, content: string, guildId?: string): Promise<Memory | null> {
    if (!this.ensureEnabled()) {
      return null
    }

    try {
      const textForEmbedding = this.buildEnhancedEmbeddingText(content, {
        key,
        category: undefined,
      })
      const embedding = await generateEmbedding(textForEmbedding, this.config)
      const embeddingStr = JSON.stringify(embedding)

      const result = await this.db!.$executeRawUnsafe(
        `UPDATE memories
         SET content = $1, embedding = $2::vector, updated_at = NOW()
         WHERE key = $3${guildId ? ' AND guild_id = $4' : ''}`,
        content,
        embeddingStr,
        key,
        ...(guildId ? [guildId] : []),
      )

      if (result === 0) {
        this.logger.warn(`No memory found to update: key=${key}`, 'memory-service')
        return null
      }

      const rows = await this.db!.$queryRawUnsafe<
        Array<{
          id: string
          key: string | null
          content: string
          category: string
          guild_id: string | null
          created_at: Date
          updated_at: Date
        }>
      >(
        `SELECT id, key, content, category, guild_id, created_at, updated_at
         FROM memories
         WHERE key = $1${guildId ? ' AND guild_id = $2' : ''}`,
        key,
        ...(guildId ? [guildId] : []),
      )

      const updated = rows[0]
      if (!updated) {
        return null
      }

      this.logger.info(`Memory updated: ${key} (id=${updated.id})`, 'memory-service')
      return this.mapRowToMemory({
        id: updated.id,
        key: updated.key,
        content: updated.content,
        embedding: null,
        category: updated.category,
        guildId: updated.guild_id,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      })
    } catch (error) {
      this.logError('update memory', error)
      return null
    }
  }

  async upsertMemory(
    key: string,
    content: string,
    options: SaveMemoryOptions = {},
  ): Promise<Memory | null> {
    if (!this.ensureEnabled()) {
      return null
    }

    const existing = await this.getMemoryByKey(key, options.guildId)

    if (existing) {
      return this.updateMemory(key, content, options.guildId)
    }

    return this.saveMemory(content, { ...options, key })
  }

  async searchMemories(
    query: string,
    options: SearchMemoryOptions = {},
  ): Promise<MemorySearchResult[]> {
    if (!this.ensureEnabled()) {
      return []
    }

    try {
      const queryEmbedding = await generateEmbedding(query, this.config)
      const limit = options.limit || 5
      const threshold = options.threshold || 0.7
      const embeddingStr = JSON.stringify(queryEmbedding)

      const rows = await this.db!.$queryRawUnsafe<
        Array<{
          id: string
          key: string | null
          content: string
          embedding: string | null
          category: string | null
          guild_id: string | null
          created_at: Date
          updated_at: Date
          similarity: number
        }>
      >(
        `SELECT 
          id, 
          key, 
          content, 
          embedding, 
          category, 
          guild_id, 
          created_at, 
          updated_at,
          1 - (embedding <=> $1::vector) as similarity
        FROM memories
        WHERE 1 - (embedding <=> $1::vector) >= $2
          AND ($3::text IS NULL OR category = $3)
          AND ($4::text IS NULL OR guild_id = $4)
        ORDER BY similarity DESC
        LIMIT $5`,
        embeddingStr,
        threshold,
        options.category || null,
        options.guildId || null,
        limit,
      )

      this.logger.debug(
        `Embedding search returned ${rows.length} results: ${JSON.stringify(rows.map((r) => ({ key: r.key, similarity: r.similarity })))}`,
        'memory-service',
      )

      return rows.map((row) => ({
        memory: this.mapRowToMemory({
          id: row.id,
          key: row.key,
          content: row.content,
          embedding: row.embedding,
          category: row.category,
          guildId: row.guild_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }),
        similarity: row.similarity,
      }))
    } catch (error) {
      this.logError('search memories', error)
      return []
    }
  }

  async getMemoryByKey(key: string, guildId?: string): Promise<Memory | null> {
    if (!this.ensureEnabled()) {
      return null
    }

    try {
      const row = await this.db!.memory.findFirst({
        where: {
          key,
          ...(guildId && { guildId }),
        },
      })

      if (!row) {
        return null
      }

      return this.mapRowToMemory(row)
    } catch (error) {
      this.logError('get memory by key', error)
      return null
    }
  }

  async deleteMemory(key: string, guildId?: string): Promise<boolean> {
    if (!this.ensureEnabled()) {
      return false
    }

    try {
      const result = await this.db!.memory.deleteMany({
        where: {
          key,
          ...(guildId && { guildId }),
        },
      })

      if (result.count === 0) {
        this.logger.warn(`No memory found to delete: key=${key}`, 'memory-service')
        return false
      }

      this.logger.info(`Memory deleted: ${key}`, 'memory-service')
      return true
    } catch (error) {
      this.logError('delete memory', error)
      return false
    }
  }

  async listMemories(
    options: { category?: string; guildId?: string; limit?: number } = {},
  ): Promise<Memory[]> {
    if (!this.ensureEnabled()) {
      return []
    }

    try {
      const rows = await this.db!.memory.findMany({
        where: {
          ...(options.category && { category: options.category }),
          ...(options.guildId && { guildId: options.guildId }),
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: options.limit || 50,
      })

      return rows.map((row) => this.mapRowToMemory(row))
    } catch (error) {
      this.logError('list memories', error)
      return []
    }
  }
}
