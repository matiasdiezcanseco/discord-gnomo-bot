import { tool } from 'ai'
import { z } from 'zod'
import type { Guild, TextChannel } from 'discord.js'
import type { AgentRegistry } from '../agents/types.ts'
import { LookupUserAgent } from '../agents/lookup-user-agent.ts'
import { LookupAllUsersAgent } from '../agents/lookup-all-users-agent.ts'
import { ReminderAgent } from '../agents/reminder-agent.ts'

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
 * @param channel Optional Discord channel for reminder functionality
 * @param userInfo Optional user information for context
 */
export function createRoutingTools(
  agents: AgentRegistry,
  guild?: Guild | null,
  channel?: TextChannel | null,
  userInfo?: { userId: string; username: string } | null,
) {
  // Set guild on lookupUser agent if available
  const lookupUserAgent = agents['lookupUser'] as LookupUserAgent | undefined
  if (lookupUserAgent && guild) {
    lookupUserAgent.setGuild(guild)
  }

  // Set guild on lookupAllUsers agent if available
  const lookupAllUsersAgent = agents['lookupAllUsers'] as LookupAllUsersAgent | undefined
  if (lookupAllUsersAgent && guild) {
    lookupAllUsersAgent.setGuild(guild)
  }

  // Get reminder agent for setReminder tool
  const reminderAgent = agents['reminder'] as ReminderAgent | undefined

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
    lookupAllUsers: tool({
      description:
        'Obtiene una lista de todos los usuarios en el servidor de Discord. Usa esto cuando el usuario quiera ver todos los miembros del servidor o necesites información sobre todos los usuarios.',
      inputSchema: z.object({}),
      execute: async () => {
        const result = await executeAgent(
          agents,
          'lookupAllUsers',
          '',
          'Lookup all users agent no disponible',
        )
        // Parse the JSON response to return structured data
        if (result.text) {
          try {
            return JSON.parse(result.text)
          } catch {
            return { success: result.success, users: [], message: result.text }
          }
        }
        return { success: false, users: [], message: 'Error en la búsqueda' }
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
    setReminder: tool({
      description:
        'Crea un recordatorio para el usuario. Usa esto cuando el usuario quiera que le recuerdes algo en el futuro. Ejemplos: "recuérdame en 2 horas...", "avísame mañana...", "en 30 minutos recuérdame..."',
      inputSchema: z.object({
        timeExpression: z
          .string()
          .describe(
            'La expresión de tiempo del usuario, ej: "en 2 horas", "mañana a las 9am", "en 30 minutos"',
          ),
        reminderMessage: z
          .string()
          .describe('El mensaje o cosa que el usuario quiere que le recuerdes'),
      }),
      execute: async ({ timeExpression, reminderMessage }) => {
        if (!reminderAgent || !channel) {
          return { success: false, text: 'Servicio de recordatorios no disponible' }
        }

        // Create the input JSON for the reminder agent
        const input = JSON.stringify({
          timeExpression,
          reminderMessage,
          channelId: channel.id,
          userId: userInfo?.userId || '',
          username: userInfo?.username || 'Usuario',
        })

        const response = await reminderAgent.handle(input)
        return { success: response.success, text: response.text }
      },
    }),
  }
}
