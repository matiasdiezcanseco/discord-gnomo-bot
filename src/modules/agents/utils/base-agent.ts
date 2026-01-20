import type { Agent, AgentResponse } from './agent-types';
import { LoggerService } from '../../services/logger/logger.service';
import {
  createSuccessResponse,
  createErrorResponse,
  withAgentErrorHandling,
} from './agent-utils';

/**
 * Base class for simple agents that fetch a single resource
 * Eliminates boilerplate for agents like PhraseAgent and ImageAgent
 */
export abstract class SimpleResourceAgent implements Agent {
  abstract name: string;

  constructor(protected readonly logger: LoggerService) {}

  /**
   * Fetch the resource (phrase, image URL, etc.)
   * @returns The resource string or null if not available
   */
  protected abstract fetchResource(): Promise<string | null>;

  async handle(): Promise<AgentResponse> {
    return withAgentErrorHandling(this.name, async () => {
      const resource = await this.fetchResource();
      if (!resource) {
        return createErrorResponse(this.name);
      }
      return createSuccessResponse(this.name, resource);
    }, this.logger);
  }
}
