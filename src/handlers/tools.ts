import { tool } from 'ai'
import { z } from 'zod'
import type { Guild } from 'discord.js'
import type { AgentRegistry } from '../agents/types.ts'
import { LookupUserAgent } from '../agents/lookup-user-agent.ts'

/**
 * Execute an agent and return a standardized tool result
 */
async function executeAgent(
  agents: AgentRegistry,
  agentKey: string,
  input: string = '',
  fallbackError: string = 'Agent no disponible',
): Promise<{ success: boolean; text: string | null }> {
  const agent = agents[agentKey]
  if (!agent) {
    return { success: false, text: fallbackError }
  }
  const response = await agent.handle(input)
  return { success: response.success, text: response.text }
}

/**
 * Create tools for routing to other agents and performing web searches
 * @param agents Registry of available agents
 * @param guild Optional Discord guild for user lookup functionality
 */
export function createRoutingTools(agents: AgentRegistry, guild?: Guild | null) {
  // Set guild on lookupUser agent if available
  const lookupUserAgent = agents['lookupUser'] as LookupUserAgent | undefined
  if (lookupUserAgent && guild) {
    lookupUserAgent.setGuild(guild)
  }

  return {
    lookupUser: tool({
      description:
        'Busca un usuario en el servidor de Discord por su nombre de usuario o nombre visible. Usa esto cuando necesites mencionar o etiquetar a un usuario específico. Retorna la mención del usuario si lo encuentra.',
      inputSchema: z.object({
        name: z.string().describe('El nombre de usuario o nombre visible a buscar'),
      }),
      execute: async ({ name }) => {
        const result = await executeAgent(
          agents,
          'lookupUser',
          name,
          'Lookup user agent no disponible',
        )
        // Parse the JSON response to return structured data
        if (result.text) {
          try {
            return JSON.parse(result.text)
          } catch {
            return { success: result.success, mention: null, message: result.text }
          }
        }
        return { success: false, mention: null, message: 'Error en la búsqueda' }
      },
    }),
    generatePhrase: tool({
      description:
        'Envía una frase o cita aleatoria al usuario. Usa esto cuando el usuario quiera una frase.',
      inputSchema: z.object({}),
      execute: () => executeAgent(agents, 'phrase'),
    }),
    generateImage: tool({
      description:
        'Envía una imagen o foto aleatoria al usuario. Usa esto cuando el usuario quiera ver una imagen o una foto.',
      inputSchema: z.object({}),
      execute: () => executeAgent(agents, 'image'),
    }),
    webSearch: tool({
      description:
        'Busca información actualizada en internet. Usa esto cuando necesites datos actuales, noticias, información que no conoces, o cualquier pregunta que requiera información en tiempo real.',
      inputSchema: z.object({
        query: z.string().describe('La consulta de búsqueda en español o inglés'),
      }),
      execute: ({ query }) =>
        executeAgent(agents, 'webSearch', query, 'Web search agent no disponible'),
    }),
  }
}
