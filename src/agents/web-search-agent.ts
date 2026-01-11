import { tavily } from '@tavily/core'
import type { Agent, AgentResponse } from './types.ts'
import {
  createSuccessResponse,
  createErrorResponse,
  withAgentErrorHandling,
} from '../utils/agent-utils.ts'

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
    return withAgentErrorHandling(this.name, async () => {
      const apiKey = process.env.TAVILY_API_KEY
      if (!apiKey) {
        return createErrorResponse(this.name, 'Error: Tavily API key no configurada')
      }

      const tvly = tavily({ apiKey })
      const response = await tvly.search(query, {
        searchDepth: 'basic',
        maxResults: 5,
      })

      if (!response?.results?.length) {
        return createErrorResponse(this.name, 'No se encontraron resultados para tu búsqueda')
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

      return createSuccessResponse(this.name, resultText)
    })
  }
}
