import { tavily } from '@tavily/core'
import type { Agent, AgentResponse } from './types.ts'
import { ENV } from '../config/env.ts'
import { MAX_SEARCH_RESULTS } from '../config/constants.ts'
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
      if (!ENV.TAVILY_API_KEY) {
        return createErrorResponse(this.name, 'Error: Tavily API key no configurada')
      }

      const tvly = tavily({ apiKey: ENV.TAVILY_API_KEY })
      const response = await tvly.search(query, {
        searchDepth: 'basic',
        maxResults: MAX_SEARCH_RESULTS,
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
