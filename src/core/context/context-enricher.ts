import type { BotContext } from './bot-context'

export interface ContextEnricher {
  readonly priority: number
  enrich(ctx: BotContext): Promise<BotContext>
}

export const ENRICHERS = 'ENRICHERS'
