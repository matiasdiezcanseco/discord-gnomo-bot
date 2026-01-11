import type { Agent, AgentResponse } from './types.ts'
import { generatePhrase } from '../functions/generate-phrase.ts'
import {
  createSuccessResponse,
  createErrorResponse,
  withAgentErrorHandling,
} from '../utils/agent-utils.ts'

/**
 * Specialized agent for generating random phrases/quotes
 */
export class PhraseAgent implements Agent {
  name = 'phrase-agent'

  async handle(): Promise<AgentResponse> {
    return withAgentErrorHandling(this.name, async () => {
      const phrase = await generatePhrase()
      if (!phrase) {
        return createErrorResponse(this.name)
      }
      return createSuccessResponse(this.name, phrase)
    })
  }
}
