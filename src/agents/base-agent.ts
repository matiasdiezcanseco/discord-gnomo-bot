import type { Agent, AgentResponse } from './types.ts'
import {
  createSuccessResponse,
  createErrorResponse,
  withAgentErrorHandling,
} from '../utils/agent-utils.ts'

/**
 * Base class for simple agents that fetch a single resource
 * Eliminates boilerplate for agents like PhraseAgent and ImageAgent
 */
export abstract class SimpleResourceAgent implements Agent {
  abstract name: string

  /**
   * Fetch the resource (phrase, image URL, etc.)
   * @returns The resource string or null if not available
   */
  protected abstract fetchResource(): Promise<string | null>

  async handle(): Promise<AgentResponse> {
    return withAgentErrorHandling(this.name, async () => {
      const resource = await this.fetchResource()
      if (!resource) {
        return createErrorResponse(this.name)
      }
      return createSuccessResponse(this.name, resource)
    })
  }
}
