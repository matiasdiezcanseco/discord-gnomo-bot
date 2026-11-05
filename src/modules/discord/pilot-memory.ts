import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Pool } from 'pg'
import { embed } from 'ai'
import { openai } from '@ai-sdk/openai'
import type { MemoryDependencies } from '../../conversation/explicit-memory'

/** Owns only the new pilot pool. Startup never creates schema or imports legacy data. */
@Injectable()
export class PilotMemory implements OnModuleDestroy {
  readonly dependencies?: MemoryDependencies
  constructor(config: ConfigService) {
    const url = config.get<string>('PILOT_MEMORY_DATABASE_URL')
    if (!url) return
    const pool = new Pool({
      connectionString: url,
      max: 4,
      connectionTimeoutMillis: 1000,
      statement_timeout: 2000,
      idleTimeoutMillis: 10000,
    })
    // Idle connection failures must not terminate chat or log data-bearing SQL errors.
    pool.on('error', () => undefined)
    const model = config.get<string>('PILOT_MEMORY_EMBEDDING_MODEL')
    this.dependencies = {
      pool,
      embedding: model
        ? {
            model,
            embed: async (text, signal) =>
              (
                await embed({
                  model: openai.embedding(model),
                  value: text,
                  abortSignal: signal,
                  maxRetries: 0,
                })
              ).embedding,
          }
        : undefined,
    }
  }
  async onModuleDestroy() {
    await this.dependencies?.pool.end()
  }
}
