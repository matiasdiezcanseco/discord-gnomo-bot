import { Agent, AgentResponse } from './types.ts'
import { generatePhrase } from '../functions/generate-phrase.ts'

/**
 * Specialized agent for generating random phrases/quotes
 */
export class PhraseAgent implements Agent {
  name = 'phrase-agent'

  async handle(message: string): Promise<AgentResponse> {
    try {
      const phrase = await generatePhrase()

      if (!phrase) {
        return {
          agentName: this.name,
          text: null,
          success: false,
        }
      }

      return {
        agentName: this.name,
        text: phrase,
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
