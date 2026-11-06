import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Pool } from 'pg'
import { embed } from 'ai'
import { openai } from '@ai-sdk/openai'
import type { MemoryDependencies } from '../../conversation/explicit-memory'
import { databasePoolConfig, databaseVariables } from '../../database/configuration'

/** Owns only the new pilot pool. Startup never creates schema or imports legacy data. */
@Injectable()
export class RuntimeMemory implements OnModuleDestroy {
  readonly dependencies?: MemoryDependencies
  constructor(config: ConfigService) {
    const options = databasePoolConfig(
      Object.fromEntries(databaseVariables.map((key) => [key, config.get<string>(key)])),
      'runtime',
    )
    if (!options) return
    const pool = new Pool(options)
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
