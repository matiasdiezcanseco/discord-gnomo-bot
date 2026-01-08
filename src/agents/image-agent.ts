import { Agent, AgentResponse } from './types.ts'
import { generateImage } from '../functions/generate-image.ts'

/**
 * Specialized agent for generating random images
 */
export class ImageAgent implements Agent {
  name = 'image-agent'

  async handle(message: string): Promise<AgentResponse> {
    try {
      const imageUrl = await generateImage()

      if (!imageUrl) {
        return {
          agentName: this.name,
          text: null,
          success: false,
        }
      }

      return {
        agentName: this.name,
        text: imageUrl,
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
