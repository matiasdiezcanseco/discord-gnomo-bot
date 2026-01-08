/**
 * Base interface that all agents must implement
 */
export interface Agent {
  /**
   * The name identifier for this agent
   */
  name: string

  /**
   * Handle a user message and return a response
   * @param message The user's message
   * @returns A promise that resolves to an AgentResponse
   */
  handle(message: string): Promise<AgentResponse>
}

/**
 * Standardized response format for all agents
 */
export interface AgentResponse {
  /**
   * The name of the agent that handled the request
   */
  agentName: string

  /**
   * The text response to send to the user
   * Null if the agent couldn't process the request
   */
  text: string | null

  /**
   * Whether the request was successfully handled
   */
  success: boolean
}

/**
 * Registry of available agents
 */
export interface AgentRegistry {
  [key: string]: Agent
}
