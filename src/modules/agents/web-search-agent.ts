import { Injectable } from '@nestjs/common';
import { tavily } from '@tavily/core';
import type { Agent, AgentResponse } from './utils/agent-types';
import { ConfigService } from '@nestjs/config';
import { MAX_SEARCH_RESULTS } from '../config/constants';
import {
  createSuccessResponse,
  createErrorResponse,
  withAgentErrorHandling,
} from './utils/agent-utils';
import { LoggerService } from '../services/logger/logger.service';

/**
 * Web search agent that performs internet searches using Tavily
 */
@Injectable()
export class WebSearchAgent implements Agent {
  name = 'web-search-agent';

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Perform a web search
   * @param query The search query
   */
  async handle(query: string): Promise<AgentResponse> {
    return withAgentErrorHandling(this.name, async () => {
      const apiKey = this.config.get<string>('TAVILY_API_KEY');
      
      
      if (!apiKey) {
        return createErrorResponse(
          this.name,
          'Error: Tavily API key no configurada',
        );
      }
      
      const tvly = tavily({ apiKey });
      const response = await tvly.search(query, {
        searchDepth: 'basic',
        maxResults: MAX_SEARCH_RESULTS,
      });


      if (!response?.results?.length) {
        return createErrorResponse(
          this.name,
          'No se encontraron resultados para tu búsqueda',
        );
      }

      // Format results for display
      const formattedResults = response.results
        .map(
          (result, index) =>
            `${index + 1}. ${result.title}\n   ${result.content}\n   Fuente: ${result.url}`,
        )
        .join('\n\n');

      // Return formatted results with optional answer
      const resultText = response.answer
        ? `${response.answer}\n\nFuentes:\n${formattedResults}`
        : formattedResults;

      return createSuccessResponse(this.name, resultText);
    }, this.logger);
  }
}
