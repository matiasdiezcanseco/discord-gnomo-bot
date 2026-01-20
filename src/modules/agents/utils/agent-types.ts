import type { Tool, UserInfo } from './base-tool';

// Re-export UserInfo for use in other modules
export type { UserInfo };

/**
 * Message history entry for conversation context
 */
export interface MessageHistory {
  role: 'user' | 'assistant';
  username: string;
  userId: string;
  content: string;
  timestamp: number;
}

/**
 * Base interface that all agents must implement
 */
export interface Agent {
  /**
   * The name identifier for this agent
   */
  name: string;

  /**
   * Handle a user message and return a response
   * @param message The user's message
   * @param userInfo Optional user information (username, userId)
   * @param history Optional conversation history for context
   * @param guild Optional Discord guild for additional functionality
   * @returns A promise that resolves to an AgentResponse
   */
  handle(
    message: string,
    userInfo?: UserInfo,
    history?: MessageHistory[],
    guild?: unknown,
  ): Promise<AgentResponse>;
}

/**
 * Standardized response format for all agents
 */
export interface AgentResponse {
  /**
   * The name of the agent that handled the request
   */
  agentName: string;

  /**
   * The text response to send to the user
   * Null if the agent couldn't process the request
   */
  text: string | null;

  /**
   * Whether the request was successfully handled
   */
  success: boolean;
}

/**
 * Registry of available agents
 */
export interface AgentRegistry {
  [key: string]: Agent;
}

/**
 * Registry of available tools
 */
export interface ToolRegistry {
  [key: string]: Tool;
}
