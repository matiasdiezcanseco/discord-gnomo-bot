import type { Guild, TextChannel } from 'discord.js';
import { LoggerService } from '../../services/logger/logger.service';

/**
 * User information for context
 */
export interface UserInfo {
  username: string;
  userId: string;
}

/**
 * Tool response format for structured data
 */
export interface ToolResponse {
  success: boolean;
  text: string | null;
  data?: unknown;
}

/**
 * Base interface that all tools must implement
 * Tools are utility functions that don't use LLMs
 */
export interface Tool {
  /**
   * The name identifier for this tool
   */
  name: string;

  /**
   * Execute the tool's logic and return a response
   * @param input The input data for the tool (varies by tool)
   * @param guild Optional Discord guild for tools that need Discord context
   * @param channel Optional Discord channel for tools that need channel context
   * @param userInfo Optional user information for context
   * @returns A promise that resolves to a ToolResponse
   */
  execute(
    input?: unknown,
    guild?: Guild | null,
    channel?: TextChannel | null,
    userInfo?: UserInfo | null,
  ): Promise<ToolResponse>;
}

/**
 * Abstract base class for tools with common functionality
 * Provides error handling and logging
 */
export abstract class BaseTool implements Tool {
  abstract name: string;

  constructor(protected readonly logger: LoggerService) {}

  /**
   * Execute with automatic error handling
   */
  async execute(
    input?: unknown,
    guild?: Guild | null,
    channel?: TextChannel | null,
    userInfo?: UserInfo | null,
  ): Promise<ToolResponse> {
    try {
      const result = await this.run(input, guild, channel, userInfo);
      return result;
    } catch (error) {
      this.logger.error({ err: error, tool: this.name }, 'Tool execution failed');
      return {
        success: false,
        text: `${this.name} no disponible`,
      };
    }
  }

  /**
   * The actual tool logic to implement
   */
  protected abstract run(
    input?: unknown,
    guild?: Guild | null,
    channel?: TextChannel | null,
    userInfo?: UserInfo | null,
  ): Promise<ToolResponse>;

  /**
   * Create a success response
   */
  protected createSuccessResponse(text: string, data?: unknown): ToolResponse {
    return {
      success: true,
      text,
      data,
    };
  }

  /**
   * Create an error response
   */
  protected createErrorResponse(
    text?: string,
    data?: unknown,
  ): ToolResponse {
    return {
      success: false,
      text: text || `${this.name} no disponible`,
      data,
    };
  }
}
