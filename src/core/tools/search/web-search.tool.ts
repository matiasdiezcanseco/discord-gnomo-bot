import { Injectable } from '@nestjs/common'
import { tool } from 'ai'
import { z } from 'zod'
import { tavily } from '@tavily/core'
import type { Tool } from 'ai'
import type { BotTool } from '../tool.interface'
import type { BotContext } from '../../context/bot-context'
import { ConfigService } from '@nestjs/config'
import { MAX_SEARCH_RESULTS } from '../../../modules/config/constants'
import { LoggerService } from '../../../modules/services/logger/logger.service'

@Injectable()
export class WebSearchTool implements BotTool {
  readonly name = 'web-search'

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  build(_ctx: BotContext): Record<string, Tool> {
    return {
      webSearch: tool({
        description:
          'Busca información actualizada en internet. Usa esto cuando necesites datos actuales, noticias, información que no conoces, o cualquier pregunta que requiera información en tiempo real.',
        inputSchema: z.object({
          query: z.string().describe('La consulta de búsqueda en español o inglés'),
        }),
        execute: async ({ query }) => {
          this.logger.debug({ query }, 'Performing web search')

          const apiKey = this.config.get<string>('TAVILY_API_KEY')

          if (!apiKey) {
            this.logger.warn({ query }, 'Tavily API key not configured')
            return { success: false, text: 'Error: Tavily API key no configurada' }
          }

          try {
            const tvly = tavily({ apiKey })
            const response = await tvly.search(query, {
              searchDepth: 'basic',
              maxResults: MAX_SEARCH_RESULTS,
            })

            if (!response?.results?.length) {
              this.logger.debug({ query }, 'No search results found')
              return { success: false, text: 'No se encontraron resultados para tu búsqueda' }
            }

            const formattedResults = response.results
              .map(
                (result, index) =>
                  `${index + 1}. ${result.title}\n   ${result.content}\n   Fuente: ${result.url}`,
              )
              .join('\n\n')

            const resultText = response.answer
              ? `${response.answer}\n\nFuentes:\n${formattedResults}`
              : formattedResults

            this.logger.log(
              {
                query,
                resultsCount: response.results.length,
                hasAnswer: !!response.answer,
              },
              'Web search completed successfully',
            )

            return { success: true, text: resultText }
          } catch (error) {
            this.logger.error({ err: error, query }, 'Web search failed')
            return { success: false, text: 'Error al realizar la búsqueda' }
          }
        },
      }),
    }
  }
}
