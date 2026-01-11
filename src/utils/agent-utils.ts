import type { AgentResponse } from '../agents/types.ts'
import { createLogger } from '../services/logger.ts'

const log = createLogger('agent-utils')

/**
 * Create a successful agent response
 * @param agentName Name of the agent
 * @param text Response text
 * @returns Standardized success response
 */
export function createSuccessResponse(agentName: string, text: string): AgentResponse {
  return {
    agentName,
    text,
    success: true,
  }
}

/**
 * Create a failed agent response
 * @param agentName Name of the agent
 * @param text Optional error message text
 * @returns Standardized error response
 */
export function createErrorResponse(agentName: string, text: string | null = null): AgentResponse {
  return {
    agentName,
    text,
    success: false,
  }
}

/**
 * Wrap an async operation with standard agent error handling
 * @param agentName Name of the agent for logging and response
 * @param operation The async operation to execute
 * @returns AgentResponse from the operation or error response on failure
 */
export async function withAgentErrorHandling(
  agentName: string,
  operation: () => Promise<AgentResponse>,
): Promise<AgentResponse> {
  try {
    return await operation()
  } catch (error) {
    log.error({ err: error, agent: agentName }, 'Agent operation failed')
    return createErrorResponse(agentName, error instanceof Error ? error.message : null)
  }
}
