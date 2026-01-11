import { tavily } from '@tavily/core'
import type { Agent, AgentResponse } from './types.ts'

/**
 * Web search agent that performs internet searches using Tavily
 */
export class WebSearchAgent implements Agent {
  name = 'web-search-agent'

  /**
   * Perform a web search
   * @param query The search query
   */
  async handle(query: string): Promise<AgentResponse> {
    try {
      const apiKey = process.env.TAVILY_API_KEY
      if (!apiKey) {
        return {
          agentName: this.name,
          text: 'Error: Tavily API key no configurada',
          success: false,
        }
      }

      const tvly = tavily({ apiKey })
      const response = await tvly.search(query, {
        searchDepth: 'basic',
        maxResults: 5,
      })

      if (!response || !response.results || response.results.length === 0) {
        return {
          agentName: this.name,
          text: 'No se encontraron resultados para tu búsqueda',
          success: false,
        }
      }

      // Format results for display
      const formattedResults = response.results
        .map(
          (result, index) =>
            `${index + 1}. ${result.title}\n   ${result.content}\n   Fuente: ${result.url}`,
        )
        .join('\n\n')

      // Return formatted results with optional answer
      const resultText = response.answer
        ? `${response.answer}\n\nFuentes:\n${formattedResults}`
        : formattedResults

      return {
        agentName: this.name,
        text: resultText,
        success: true,
      }
    } catch (error) {
      console.error(`Error in ${this.name}:`, error)
      return {
        agentName: this.name,
        text: 'Error al realizar la búsqueda web',
        success: false,
      }
    }
  }
}
