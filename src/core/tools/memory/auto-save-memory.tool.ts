import { Injectable } from '@nestjs/common'
import { tool } from 'ai'
import { z } from 'zod'
import type { Tool } from 'ai'
import type { BotTool } from '../tool.interface'
import type { BotContext } from '../../context/bot-context'
import { MemoryService } from '../../../modules/services/memory/memory.service'

@Injectable()
export class AutoSaveMemoryTool implements BotTool {
  readonly name = 'auto-save-memory'

  constructor(private readonly memoryService: MemoryService) {}

  build(ctx: BotContext): Record<string, Tool> {
    return {
      autoSaveMemory: tool({
        description:
          'Guarda información MUY importante que el usuario comparte. SÚSELO con moderación: solo para datos concretos como cumpleaños, qué juegos juega cada usuario, o datos del usuario. NO lo uses para opiniones, planes vagos, o conversación casual. Si dudas, NO guardes.',
        inputSchema: z.object({
          content: z
            .string()
            .describe(
              'El hecho o información importante a guardar, se descriptivo para ayudar a la generación del embedding',
            ),
          category: z
            .enum(['users', 'preferences', 'facts', 'events', 'general'])
            .describe(
              'Categoría: users=info de usuarios, preferences=gustos, facts=hechos, events=eventos',
            ),
        }),
        execute: async ({ content, category }) => {
          if (!this.memoryService.isEnabled()) {
            return { success: false, saved: false }
          }

          const memory = await this.memoryService.saveMemory(content, {
            category,
            guildId: ctx.guildId,
          })

          return { success: true, saved: !!memory }
        },
      }),
    }
  }
}
