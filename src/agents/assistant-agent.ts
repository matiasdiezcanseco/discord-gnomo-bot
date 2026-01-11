import { generateText, stepCountIs, type ModelMessage } from 'ai'
import { openai } from '@ai-sdk/openai'
import type { Agent, AgentResponse, AgentRegistry, UserInfo, MessageHistory } from './types.ts'
import { createRoutingTools } from '../functions/tools.ts'

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
   * Convert message history to AI SDK message format
   */
  private convertHistoryToMessages(history: MessageHistory[]): ModelMessage[] {
    return history.map((msg) => ({
      role: msg.role,
      content: msg.role === 'user' ? `[${msg.username}]: ${msg.content}` : msg.content,
    }))
  }

  /**
   * Handle a user message with optional context
   * @param message The current user message
   * @param userInfo Optional user information (username, userId)
   * @param history Optional conversation history for context
   */
  async handle(
    message: string,
    userInfo?: UserInfo,
    history: MessageHistory[] = [],
  ): Promise<AgentResponse> {
    try {
      // Convert history to AI SDK message format
      const historyMessages = this.convertHistoryToMessages(history)

      // Build system prompt with user context
      const userContext = userInfo ? `Estás hablando con ${userInfo.username}. ` : ''

      const systemPrompt = `Eres el Gnomo, un bot de Discord con una personalidad única. 
        ${userContext}
        
        PERSONALIDAD:
        - Eres sarcástico y con humor seco
        - A veces respondes con comentarios ingeniosos o burlones
        - Puedes ser un poco tonto o hacerte el despistado ocasionalmente (es parte de tu encanto)
        - Tus respuestas son divertidas pero sin pasarte de la raya
        - Tienes actitud, pero no eres grosero
        - A veces puedes malinterpretar cosas a propósito para hacer una broma
        - Usa expresiones coloquiales y naturales en español
        
        FUNCIONALIDAD:
        Responde siempre en español. 
        Según el mensaje del usuario, determina qué acción ejecutar.
        Llama a una herramienta si la solicitud del usuario coincide con una de las acciones disponibles. 
        Es posible que te escriban las acciones de forma corta, por ejemplo: "frase" o "pic". 
        También pueden llamarlas de forma imprevista como: "rota una foto" o "dame una frase".
        Si te preguntan algo que requiere información actualizada o que no conoces, usa la herramienta de búsqueda web.
        Si la solicitud no coincide con ninguna acción, no llames a ninguna herramienta. 
        Si retornas algún recurso como imágenes o frases, solo retorna el texto del recurso, no agregues ningún texto adicional. 
        Si retornas una url, solo retorna la url. 
        Puedes responder a peticiones que no tienen relación con las acciones disponibles.
        Los mensajes del historial incluyen el nombre de usuario entre corchetes para que sepas quién dijo qué.
        
        IMPORTANTE: Cuando envies respuestas largas debes ser conciso y directo (pero sin perder tu estilo), tus respuestas NO deben exceder los 2000 caracteres.`

      // Build current message with user context
      const currentMessage = userInfo ? `[${userInfo.username}]: ${message}` : message

      // Combine history with current message
      const messages: ModelMessage[] = [
        ...historyMessages,
        { role: 'user' as const, content: currentMessage },
      ]

      const result = await generateText({
        model: openai(process.env.OPENAI_MODEL || 'gpt-4o-mini'),
        tools: createRoutingTools(this.agents),
        toolChoice: 'auto',
        stopWhen: stepCountIs(3),
        system: systemPrompt,
        messages,
      })

      // Enforce 2000 character limit
      let responseText = result.text
      if (responseText && responseText.length > 2000) {
        responseText = responseText.substring(0, 1997) + '...'
      }

      return {
        agentName: this.name,
        text: responseText,
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
