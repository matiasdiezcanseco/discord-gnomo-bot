import { Injectable } from '@nestjs/common'
import { tool } from 'ai'
import { z } from 'zod'
import type { Tool } from 'ai'
import type { BotTool } from '../tool.interface'
import type { BotContext } from '../../context/bot-context'
import { MemoryService } from '../../../modules/services/memory/memory.service'

@Injectable()
export class QueryMemoryTool implements BotTool {
  readonly name = 'query-memory'

  constructor(private readonly memoryService: MemoryService) {}

  build(ctx: BotContext): Record<string, Tool> {
    return {
      queryMemory: tool({
        description:
          'Busca en la memoria a largo plazo información relevante. Úsalo cuando necesites recordar hechos previos, preferencias de usuarios, o información guardada. Ejemplos: cuando te preguntan "¿quién juega X?", "¿qué te dije sobre Y?"',
        inputSchema: z.object({
          query: z.string().describe('La consulta para buscar recuerdos relevantes'),
          category: z
            .enum(['users', 'preferences', 'facts', 'events', 'general'])
            .optional()
            .describe('Filtrar por categoría específica'),
        }),
        execute: async ({ query, category }) => {
          if (!this.memoryService.isEnabled()) {
            return { success: false, memories: [], text: 'Servicio de memoria no disponible' }
          }

          const results = await this.memoryService.searchMemories(query, {
            category,
            guildId: ctx.guildId,
            limit: 5,
            threshold: 0.6,
          })

          if (results.length === 0) {
            return { success: true, memories: [], text: 'No encontré recuerdos relevantes' }
          }

          const memories = results.map((r) => ({
            key: r.memory.key,
            content: r.memory.content,
            category: r.memory.category,
            relevance: Math.round(r.similarity * 100) / 100,
          }))

          return {
            success: true,
            memories,
            text: `Encontré ${memories.length} recuerdo(s) relevante(s)`,
          }
        },
      }),
    }
  }
}
