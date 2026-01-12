import { SimpleResourceAgent } from './base-agent.ts'
import { generatePhrase } from '../functions/generate-phrase.ts'

/**
 * Specialized agent for generating random phrases/quotes
 */
export class PhraseAgent extends SimpleResourceAgent {
  name = 'phrase-agent'

  protected fetchResource(): Promise<string | null> {
    return generatePhrase()
  }
}
