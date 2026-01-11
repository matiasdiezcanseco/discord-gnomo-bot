import { tool } from 'ai'
import { z } from 'zod'
import type { AgentRegistry } from '../agents/types.ts'

/**
 * Create tools for routing to other agents and performing web searches
 */
export function createRoutingTools(agents: AgentRegistry) {
  return {
    generatePhrase: tool({
      description:
        'Envía una frase o cita aleatoria al usuario. Usa esto cuando el usuario quiera una frase.',
      inputSchema: z.object({}),
      execute: async () => {
        const agent = agents['phrase']
        if (!agent) {
          return { success: false, text: null }
        }
        const response = await agent.handle('')
        return { success: response.success, text: response.text }
      },
    }),
    generateImage: tool({
      description:
        'Envía una imagen o foto aleatoria al usuario. Usa esto cuando el usuario quiera ver una imagen o una foto.',
      inputSchema: z.object({}),
      execute: async () => {
        const agent = agents['image']
        if (!agent) {
          return { success: false, text: null }
        }
        const response = await agent.handle('')
        return { success: response.success, text: response.text }
      },
    }),
    webSearch: tool({
      description:
        'Busca información actualizada en internet. Usa esto cuando necesites datos actuales, noticias, información que no conoces, o cualquier pregunta que requiera información en tiempo real.',
      inputSchema: z.object({
        query: z.string().describe('La consulta de búsqueda en español o inglés'),
      }),
      execute: async ({ query }) => {
        const agent = agents['webSearch']
        if (!agent) {
          return { success: false, text: 'Web search agent no disponible' }
        }
        const response = await agent.handle(query)
        return { success: response.success, text: response.text }
      },
    }),
  }
}
