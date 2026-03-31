import { Injectable, Inject } from '@nestjs/common'
import type { Tool } from 'ai'
import type { BotTool } from './tool.interface'
import type { BotContext } from '../context/bot-context'

export const BOT_TOOLS = 'BOT_TOOLS'

@Injectable()
export class ToolRegistryService {
  constructor(@Inject(BOT_TOOLS) private readonly tools: BotTool[]) {}

  buildTools(ctx: BotContext): Record<string, Tool> {
    let merged: Record<string, Tool> = {}

    for (const tool of this.tools) {
      const built = tool.build(ctx)
      merged = { ...merged, ...built }
    }

    return merged
  }
}
