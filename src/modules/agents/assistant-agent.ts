import { Injectable } from '@nestjs/common';
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { Guild, TextChannel } from 'discord.js';
import type { Agent, AgentResponse, UserInfo, MessageHistory } from './utils/agent-types';
import { ConfigService } from '@nestjs/config';
import { MAX_AGENT_STEPS } from '../config/constants';
import { RoutingToolsService } from '../discord/routing-tools.service';
import { getAssistantSystemPrompt } from './utils/prompts/assistant-system-prompt';
import { createSuccessResponse, createErrorResponse } from './utils/agent-utils';
import { truncateText } from './utils/text-utils';
import { LoggerService } from '../services/logger/logger.service';

/**
 * Assistant agent that handles routing to specialized agents and tools
 * This is the default agent that receives all user messages first
 */
@Injectable()
export class AssistantAgent implements Agent {
  name = 'assistant-agent';

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly routingToolsService: RoutingToolsService,
  ) {}

  /**
   * Convert message history to AI SDK message format
   */
  private convertHistoryToMessages(history: MessageHistory[]): ModelMessage[] {
    return history.map((msg) => ({
      role: msg.role,
      content: msg.role === 'user' ? `[${msg.username}]: ${msg.content}` : msg.content,
    }));
  }

  /**
   * Handle a user message with optional context
   * @param message The current user message
   * @param userInfo Optional user information (username, userId)
   * @param history Optional conversation history for context
   * @param guild Optional Discord guild for user lookup functionality
   * @param channel Optional Discord channel for reminder functionality
   */
  async handle(
    message: string,
    userInfo?: UserInfo,
    history: MessageHistory[] = [],
    guild?: Guild | null,
    channel?: TextChannel | null,
  ): Promise<AgentResponse> {
    try {
      // Convert history to AI SDK message format
      const historyMessages = this.convertHistoryToMessages(history);

      // Build system prompt with user context
      const userContext = userInfo ? `Estás hablando con ${userInfo.username}. ` : '';
      const systemPrompt = getAssistantSystemPrompt(userContext);

      // Build current message with user context
      const currentMessage = userInfo ? `[${userInfo.username}]: ${message}` : message;

      // Combine history with current message
      const messages: ModelMessage[] = [
        ...historyMessages,
        { role: 'user' as const, content: currentMessage },
      ];

      const openaiModel = this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');

      const result = await generateText({
        model: openai(openaiModel),
        tools: this.routingToolsService.getTools(guild, channel, userInfo),
        toolChoice: 'auto',
        stopWhen: stepCountIs(MAX_AGENT_STEPS),
        system: systemPrompt,
        messages,
      });

      // Enforce 2000 character limit for Discord
      const responseText = result.text ? truncateText(result.text) : result.text;

      return createSuccessResponse(this.name, responseText || '');
    } catch (error) {
      this.logger.error({ err: error }, 'Agent processing failed');
      return createErrorResponse(this.name);
    }
  }
}
