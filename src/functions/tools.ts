import { tool } from 'ai'
import { z } from 'zod'
import { userMention, type Guild } from 'discord.js'
import type { AgentRegistry } from '../agents/types.ts'
import { findUserByNameAsync } from './user-lookup.ts'

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
  return {
    lookupUser: tool({
      description:
        'Busca un usuario en el servidor de Discord por su nombre de usuario o nombre visible. Usa esto cuando necesites mencionar o etiquetar a un usuario específico. Retorna la mención del usuario si lo encuentra.',
      inputSchema: z.object({
        name: z.string().describe('El nombre de usuario o nombre visible a buscar'),
      }),
      execute: async ({ name }) => {
        if (!guild) {
          return { success: false, mention: null, message: 'No hay acceso al servidor' }
        }
        const member = await findUserByNameAsync(guild, name)
        if (member) {
          return {
            success: true,
            mention: userMention(member.id),
            username: member.user.username,
            displayName: member.displayName,
            message: `Usuario encontrado: ${member.displayName}`,
          }
        }
        return {
          success: false,
          mention: null,
          message: `No se encontró ningún usuario llamado "${name}"`,
        }
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
