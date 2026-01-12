import { generateText, stepCountIs, type ModelMessage } from 'ai'
import { openai } from '@ai-sdk/openai'
import type { Guild } from 'discord.js'
import type { Agent, AgentResponse, AgentRegistry, UserInfo, MessageHistory } from './types.ts'
import { ENV } from '../config/env.ts'
import { MAX_AGENT_STEPS } from '../config/constants.ts'
import { createRoutingTools } from '../functions/tools.ts'
import { getAssistantSystemPrompt } from '../prompts/assistant-system-prompt.ts'
import { createSuccessResponse, createErrorResponse } from '../utils/agent-utils.ts'
import { truncateText } from '../utils/text-utils.ts'
import { createLogger } from '../services/logger.ts'

const log = createLogger('assistant-agent')

/**
 * Assistant agent that handles routing to specialized agents
 * This is the default agent that receives all user messages first
 */
export class AssistantAgent implements Agent {
  name = 'assistant-agent'
  private agents: AgentRegistry

  constructor(agents: AgentRegistry) {
    this.agents = agents
  }

  /**
   * Convert message history to AI SDK message format
   */
  private convertHistoryToMessages(history: MessageHistory[]): ModelMessage[] {
    return history.map((msg) => ({
      role: msg.role,
      content: msg.role === 'user' ? `[${msg.username}]: ${msg.content}` : msg.content,
    }))
  }

  /**
   * Handle a user message with optional context
   * @param message The current user message
   * @param userInfo Optional user information (username, userId)
   * @param history Optional conversation history for context
   * @param guild Optional Discord guild for user lookup functionality
   */
  async handle(
    message: string,
    userInfo?: UserInfo,
    history: MessageHistory[] = [],
    guild?: Guild | null,
  ): Promise<AgentResponse> {
    try {
      // Convert history to AI SDK message format
      const historyMessages = this.convertHistoryToMessages(history)

      // Build system prompt with user context
      const userContext = userInfo ? `Estás hablando con ${userInfo.username}. ` : ''
      const systemPrompt = getAssistantSystemPrompt(userContext)

      // Build current message with user context
      const currentMessage = userInfo ? `[${userInfo.username}]: ${message}` : message

      // Combine history with current message
      const messages: ModelMessage[] = [
        ...historyMessages,
        { role: 'user' as const, content: currentMessage },
      ]

      const result = await generateText({
        model: openai(ENV.OPENAI_MODEL),
        tools: createRoutingTools(this.agents, guild),
        toolChoice: 'auto',
        stopWhen: stepCountIs(MAX_AGENT_STEPS),
        system: systemPrompt,
        messages,
      })

      // Enforce 2000 character limit for Discord
      const responseText = result.text ? truncateText(result.text) : result.text

      return createSuccessResponse(this.name, responseText || '')
    } catch (error) {
      log.error({ err: error }, 'Agent processing failed')
      return createErrorResponse(this.name)
    }
  }
}
