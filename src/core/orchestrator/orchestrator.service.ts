import { Injectable, Inject } from '@nestjs/common'
import { generateText, stepCountIs } from 'ai'
import { openai } from '@ai-sdk/openai'
import { ConfigService } from '@nestjs/config'
import type { ContextEnricher } from '../context/context-enricher'
import { ENRICHERS } from '../context/context-enricher'
import type { BotContext } from '../context/bot-context'
import { ToolRegistryService } from '../tools/tool-registry.service'
import { PromptBuilder } from './prompt-builder'
import { MessageBuilder } from './message-builder'
import { LoggerService } from '../../modules/services/logger/logger.service'
import { MAX_AGENT_STEPS } from '../../modules/config/constants'
import { truncateText, sanitizeResponse } from './utils/text-utils'

export interface OrchestratorResponse {
  text: string | null
  success: boolean
}

@Injectable()
export class OrchestratorService {
  constructor(
    @Inject(ENRICHERS) private readonly enrichers: ContextEnricher[],
    private readonly toolRegistry: ToolRegistryService,
    private readonly promptBuilder: PromptBuilder,
    private readonly messageBuilder: MessageBuilder,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  async handle(ctx: BotContext): Promise<OrchestratorResponse> {
    try {
      const sortedEnrichers = [...this.enrichers].sort((a, b) => a.priority - b.priority)
      let enrichedCtx = ctx
      for (const enricher of sortedEnrichers) {
        enrichedCtx = await enricher.enrich(enrichedCtx)
      }

      const tools = this.toolRegistry.buildTools(enrichedCtx)
      const system = this.promptBuilder.build(enrichedCtx)
      const messages = this.messageBuilder.build(enrichedCtx)
      const openaiModel = this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini')

      const result = await generateText({
        model: openai(openaiModel),
        tools,
        toolChoice: 'auto',
        stopWhen: stepCountIs(MAX_AGENT_STEPS),
        system,
        messages,
      })

      const responseText = result.text ? truncateText(result.text) : result.text
      const sanitizedText = responseText ? sanitizeResponse(responseText) : ''

      return { text: sanitizedText || null, success: !!sanitizedText }
    } catch (error) {
      this.logger.error({ err: error }, 'Orchestrator processing failed')
      return { text: null, success: false }
    }
  }
}
