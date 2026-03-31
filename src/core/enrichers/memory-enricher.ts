import { Injectable } from '@nestjs/common'
import type { ContextEnricher } from '../context/context-enricher'
import type { BotContext } from '../context/bot-context'
import { MemoryService } from '../../modules/services/memory/memory.service'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class MemoryEnricher implements ContextEnricher {
  readonly priority = 10

  constructor(
    private readonly memoryService: MemoryService,
    private readonly config: ConfigService,
  ) {}

  async enrich(ctx: BotContext): Promise<BotContext> {
    if (!this.memoryService.isEnabled()) {
      return ctx
    }

    try {
      const results = await this.memoryService.searchMemories(ctx.message, {
        guildId: ctx.guildId,
        limit: 5,
        threshold: 0.4,
      })

      if (results.length > 0) {
        ctx = { ...ctx, enrichedMemories: results }
      }
    } catch {
      // enrichment failure should not block the conversation
    }

    return ctx
  }
}
