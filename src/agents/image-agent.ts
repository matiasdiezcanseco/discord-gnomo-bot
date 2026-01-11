import type { Agent, AgentResponse } from './types.ts'
import { generateImage } from '../functions/generate-image.ts'
import {
  createSuccessResponse,
  createErrorResponse,
  withAgentErrorHandling,
} from '../utils/agent-utils.ts'

/**
 * Specialized agent for generating random images
 */
export class ImageAgent implements Agent {
  name = 'image-agent'

  async handle(): Promise<AgentResponse> {
    return withAgentErrorHandling(this.name, async () => {
      const imageUrl = await generateImage()
      if (!imageUrl) {
        return createErrorResponse(this.name)
      }
      return createSuccessResponse(this.name, imageUrl)
    })
  }
}
