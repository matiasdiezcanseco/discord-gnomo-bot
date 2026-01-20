import { LoggerService } from '../../services/logger/logger.service';
import type { AgentResponse } from './agent-types';

/**
 * Create a successful agent response
 * @param agentName Name of agent
 * @param text Response text
 * @returns Standardized success response
 */
export function createSuccessResponse(agentName: string, text: string): AgentResponse {
  return {
    agentName,
    text,
    success: true,
  };
}

/**
 * Create a failed agent response
 * @param agentName Name of agent
 * @param text Optional error message text
 * @returns Standardized error response
 */
export function createErrorResponse(agentName: string, text: string | null = null): AgentResponse {
  return {
    agentName,
    text,
    success: false,
  };
}

/**
 * Wrap an async operation with standard agent error handling
 * @param agentName Name of agent for logging and response
 * @param operation The async operation to execute
 * @param logger LoggerService for error logging
 * @returns AgentResponse from operation or error response on failure
 */
export async function withAgentErrorHandling(
  agentName: string,
  operation: () => Promise<AgentResponse>,
  logger: LoggerService,
): Promise<AgentResponse> {
  try {
    return await operation();
  } catch (error) {
    logger.error(
      { err: error, agent: agentName },
      'Agent operation failed',
      'agent-utils',
    );
    return createErrorResponse(agentName, error instanceof Error ? error.message : null);
  }
}
