import { SimpleResourceAgent } from './base-agent.ts'
import { generateImage } from '../functions/generate-image.ts'

/**
 * Specialized agent for generating random images
 */
export class ImageAgent extends SimpleResourceAgent {
  name = 'image-agent'

  protected fetchResource(): Promise<string | null> {
    return generateImage()
  }
}
