import { Injectable, Inject } from '@nestjs/common'
import { tool } from 'ai'
import { z } from 'zod'
import type { Guild, TextChannel } from 'discord.js'
import type { AgentRegistry, ToolRegistry, UserInfo } from '../agents/utils/agent-types'
import { ReminderAgent } from '../agents/reminder-agent'
import { MemoryService } from '../services/memory/memory.service'

export const AGENT_REGISTRY = 'AGENT_REGISTRY'

export const TOOL_REGISTRY = 'TOOL_REGISTRY'

@Injectable()
export class RoutingToolsService {
  constructor(
    @Inject(AGENT_REGISTRY) private readonly agents: AgentRegistry,
    @Inject(TOOL_REGISTRY) private readonly tools: ToolRegistry,
    private readonly memoryService: MemoryService,
  ) {}

  /**
   * Execute an agent and return a standardized tool result
   */
  private async executeAgent(
    agentKey: string,
    input: string = '',
    fallbackError: string = 'Agent no disponible',
  ): Promise<{ success: boolean; text: string | null }> {
    const agent = this.agents[agentKey]
    if (!agent) {
      return { success: false, text: fallbackError }
    }
    const response = await agent.handle(input)
    return { success: response.success, text: response.text }
  }

  /**
   * Get tools for routing to agents and performing operations
   * @param guild Optional Discord guild for user lookup functionality
   * @param channel Optional Discord channel for reminder functionality
   * @param userInfo Optional user information for context
   * @returns Object containing all routing tools for the AI SDK
   */
  getTools(guild?: Guild | null, channel?: TextChannel | null, userInfo?: UserInfo | null) {
    const lookupUserTool = this.tools['lookupUser']
    const lookupAllUsersTool = this.tools['lookupAllUsers']
    const lookupVoiceUsersTool = this.tools['lookupVoiceUsers']
    const phraseTool = this.tools['phrase']
    const imageTool = this.tools['image']
    const reminderAgent = this.agents['reminder'] as ReminderAgent | undefined

    return {
      lookupUser: tool({
        description:
          'Busca un usuario en el servidor de Discord por su nombre de usuario o nombre visible. Usa esto cuando necesites mencionar o etiquetar a un usuario específico. Retorna la mención del usuario si lo encuentra.',
        inputSchema: z.object({
          name: z.string().describe('El nombre de usuario o nombre visible a buscar'),
        }),
        execute: async ({ name }) => {
          if (!lookupUserTool) {
            return { success: false, mention: null, message: 'Lookup user tool no disponible' }
          }
          const result = await lookupUserTool.execute(name, guild)
          // Return structured data from tool.data
          if (result.data && typeof result.data === 'object') {
            return result.data as { success: boolean; mention: string | null; message?: string }
          }
          return { success: false, mention: null, message: result.text || 'Error en la búsqueda' }
        },
      }),
      lookupAllUsers: tool({
        description:
          'Obtiene una lista de todos los usuarios en el servidor de Discord. Usa esto cuando el usuario quiera ver todos los miembros del servidor o necesites información sobre todos los usuarios.',
        inputSchema: z.object({}),
        execute: async () => {
          if (!lookupAllUsersTool) {
            return { success: false, users: [], message: 'Lookup all users tool no disponible' }
          }
          const result = await lookupAllUsersTool.execute(undefined, guild)
          // Return structured data from tool.data
          if (result.data && typeof result.data === 'object') {
            return result.data as {
              success: boolean
              users: unknown[]
              count?: number
              message?: string
            }
          }
          return { success: false, users: [], message: result.text || 'Error en la búsqueda' }
        },
      }),
      lookupVoiceUsers: tool({
        description:
          'Obtiene una lista de todos los usuarios que están actualmente conectados en canales de voz del servidor. Usa esto cuando el usuario quiera saber quién está en llamada o en canales de voz.',
        inputSchema: z.object({}),
        execute: async () => {
          if (!lookupVoiceUsersTool) {
            return { success: false, users: [], message: 'Lookup voice users tool no disponible' }
          }
          const result = await lookupVoiceUsersTool.execute(undefined, guild)
          // Return structured data from tool.data
          if (result.data && typeof result.data === 'object') {
            return result.data as {
              success: boolean
              users: unknown[]
              count?: number
              message?: string
            }
          }
          return { success: false, users: [], message: result.text || 'Error en la búsqueda' }
        },
      }),
      generatePhrase: tool({
        description:
          'Envía una frase o cita aleatoria del bot de la colección de frases guardadas para recordar al Gnomo. Usa esto cuando el usuario pida una frase o se refiera a las frases del bot.',
        inputSchema: z.object({}),
        execute: async () => {
          if (!phraseTool) {
            return { success: false, text: 'Phrase tool no disponible' }
          }
          const result = await phraseTool.execute()
          return { success: result.success, text: result.text }
        },
      }),
      generateImage: tool({
        description:
          'Envía una imagen o foto aleatoria del bot de la colección de fotos guardadas para recordar al Gnomo. Usa esto cuando el usuario pida una foto, se refiera a "las fotos guardadas", "fotos para recordar al gnomo", o simplemente quiera ver una imagen.',
        inputSchema: z.object({}),
        execute: async () => {
          if (!imageTool) {
            return { success: false, text: 'Image tool no disponible' }
          }
          const result = await imageTool.execute()
          return { success: result.success, text: result.text }
        },
      }),
      webSearch: tool({
        description:
          'Busca información actualizada en internet. Usa esto cuando necesites datos actuales, noticias, información que no conoces, o cualquier pregunta que requiera información en tiempo real.',
        inputSchema: z.object({
          query: z.string().describe('La consulta de búsqueda en español o inglés'),
        }),
        execute: ({ query }) =>
          this.executeAgent('webSearch', query, 'Web search agent no disponible'),
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

          // Create input JSON for reminder agent
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
            guildId: guild?.id,
          })

          if (memory) {
            return { success: true, text: `Recuerdo guardado: ${key}` }
          }
          return { success: false, text: 'No se pudo guardar el recuerdo' }
        },
      }),
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
            guildId: guild?.id,
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
            guildId: guild?.id,
          })

          return { success: true, saved: !!memory }
        },
      }),
    }
  }
}
