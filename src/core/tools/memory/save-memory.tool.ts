import { Injectable } from '@nestjs/common'
import { tool } from 'ai'
import { z } from 'zod'
import type { Tool } from 'ai'
import type { BotTool } from '../tool.interface'
import type { BotContext } from '../../context/bot-context'
import { MemoryService } from '../../../modules/services/memory/memory.service'

@Injectable()
export class SaveMemoryTool implements BotTool {
  readonly name = 'save-memory'

  constructor(private readonly memoryService: MemoryService) {}

  build(ctx: BotContext): Record<string, Tool> {
    return {
      saveMemory: tool({
        description:
          'Guarda un hecho o información importante en la memoria a largo plazo. Úsalo cuando el usuario te pida explícitamente que recuerdes algo. Ejemplos: "recuerda que...", "guarda esto...", "anota que..."',
        inputSchema: z.object({
          key: z
            .string()
            .describe(
              'Clave única en español y formato snake_case para identificar el recuerdo, ej: "jugadores_battlefield", "cumpleaños_juan"',
            ),
          content: z
            .string()
            .describe(
              'El contenido a recordar, ej: "Los usuarios que juegan battlefield son: @juan, @pedro"',
            ),
          category: z
            .enum(['users', 'preferences', 'facts', 'events', 'general'])
            .optional()
            .describe('Categoría del recuerdo'),
        }),
        execute: async ({ key, content, category }) => {
          if (!this.memoryService.isEnabled()) {
            return { success: false, text: 'Servicio de memoria no disponible' }
          }

          const memory = await this.memoryService.upsertMemory(key, content, {
            category,
            guildId: ctx.guildId,
          })

          if (memory) {
            return { success: true, text: `Recuerdo guardado: ${key}` }
          }
          return { success: false, text: 'No se pudo guardar el recuerdo' }
        },
      }),
    }
  }
}
