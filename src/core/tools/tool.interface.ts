import type { Tool } from 'ai'
import type { BotContext } from '../context/bot-context'

export interface BotTool {
  readonly name: string
  build(ctx: BotContext): Record<string, Tool>
}
