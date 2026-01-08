import { generateText, tool, stepCountIs } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import type { Agent, AgentResponse, AgentRegistry } from './types.ts'

/**
 * Assistant agent that handles routing to specialized agents
 * This is the default agent that receives all user messages first
 */
export class AssistantAgent implements Agent {
  name = 'assistant-agent'
  private agents: AgentRegistry

  constructor(agents: AgentRegistry) {
    this.agents = agents
  }

  /**
   * Create tools for routing to other agents
   */
  private createRoutingTools() {
    return {
      generatePhrase: tool({
        description:
          'Envía una frase o cita aleatoria al usuario. Usa esto cuando el usuario quiera una frase.',
        inputSchema: z.object({}),
        execute: async () => {
          const agent = this.agents['phrase']
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
          const agent = this.agents['image']
          if (!agent) {
            return { success: false, text: null }
          }
          const response = await agent.handle('')
          return { success: response.success, text: response.text }
        },
      }),
    }
  }

  async handle(message: string): Promise<AgentResponse> {
    try {
      const result = await generateText({
        model: openai('gpt-4o-mini'),
        tools: this.createRoutingTools(),
        toolChoice: 'auto',
        stopWhen: stepCountIs(2),
        system: `Eres un asistente de bot de Discord. Responde siempre en español. Según el mensaje del usuario, determina qué acción ejecutar.
Llama a una herramienta si la solicitud del usuario coincide con una de las acciones disponibles. Es posible que te escriban las acciones de forma corta, por ejemplo: "frase" o "pic". También pueden llamarlas de forma imprevista como: "rota una foto" o "dame una frase".
Si la solicitud no coincide con ninguna acción, no llames a ninguna herramienta. Si retornas algún recurso como imágenes o frases, solo retorna el texto del recurso, no agregues ningún texto adicional. Si retornas una url, solo retorna la url. Nunca respondas a peticiones que no tienen relación con las acciones disponibles. En caso pregunten otras cosas, recuérdales lo que puedes hacer.`,
        prompt: message,
      })

      return {
        agentName: this.name,
        text: result.text,
        success: true,
      }
    } catch (error) {
      console.error(`Error in ${this.name}:`, error)
      return {
        agentName: this.name,
        text: null,
        success: false,
      }
    }
  }
}
