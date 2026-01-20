import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { Agent, AgentResponse, UserInfo } from './utils/agent-types';
import { createSuccessResponse, createErrorResponse } from './utils/agent-utils';
import { ReminderService } from '../services/reminder/reminder.service';
import { getTimeParserPrompt } from './utils/prompts/time-parser-prompt';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../services/logger/logger.service';

// Configure dayjs with timezone support
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Input for reminder agent
 */
export interface ReminderInput {
  timeExpression: string;
  reminderMessage: string;
  channelId: string;
  userId: string;
  username: string;
}

/**
 * Schema for AI-parsed time
 */
const timeParseSchema = z.object({
  minutes: z
    .number()
    .describe('Number of minutes from now when reminder should trigger. Must be positive.'),
  humanReadable: z
    .string()
    .describe(
      'Human-readable description of when reminder will trigger, in Spanish. Example: "en 2 horas", "mañana a las 9:00"',
    ),
  valid: z.boolean().describe('Whether time expression could be parsed successfully'),
});

/**
 * Agent that handles creating reminders
 * Uses AI to parse time expressions and stores reminders in Redis
 */
@Injectable()
export class ReminderAgent implements Agent {
  name = 'reminder-agent';

  constructor(
    private readonly reminderService: ReminderService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Parse Spanish time expression using AI
   */
  private async parseTimeExpression(
    timeExpression: string,
  ): Promise<{ timestamp: number; humanReadable: string } | null> {
    try {
      // Use user's timezone instead of server timezone
      const userTimezone = this.config.get<string>('USER_TIMEZONE', 'America/Bogota');
      const openaiModel = this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
      
      const now = dayjs().tz(userTimezone);
      const currentDateTime = now.format('YYYY-MM-DD HH:mm:ss');
      const currentDayOfWeek = now.format('dddd');

      const result = await generateText({
        model: openai(openaiModel),
        output: Output.object({
          schema: timeParseSchema,
        }),
        prompt: getTimeParserPrompt(currentDateTime, currentDayOfWeek, timeExpression),
      });

      if (!result.output.valid || result.output.minutes <= 0) {
        this.logger.debug({ timeExpression }, 'Could not parse time expression');
        return null;
      }

      const timestamp = now.add(result.output.minutes, 'minute').valueOf();

      this.logger.debug(
        {
          timeExpression,
          minutes: result.output.minutes,
          humanReadable: result.output.humanReadable,
        },
        'Parsed time expression',
      );

      return { timestamp, humanReadable: result.output.humanReadable };
    } catch (error) {
      this.logger.error({ err: error, timeExpression }, 'Failed to parse time expression');
      return null;
    }
  }

  /**
   * Handle a reminder creation request
   * @param message JSON string containing ReminderInput
   * @param userInfo Optional user information
   */
  async handle(message: string, userInfo?: UserInfo): Promise<AgentResponse> {
    if (!this.reminderService.isAvailable()) {
      this.logger.warn('Reminder service not available');
      return createErrorResponse(
        this.name,
        'Lo siento, el servicio de recordatorios no está disponible en este momento.',
      );
    }

    try {
      const input: ReminderInput = JSON.parse(message);
      const { timeExpression, reminderMessage, channelId, userId, username } = input;

      // Parse time expression using AI
      const parsedTime = await this.parseTimeExpression(timeExpression);
      if (!parsedTime) {
        return createErrorResponse(
          this.name,
          `No pude entender el tiempo "${timeExpression}". Intenta con algo como "en 2 horas", "en 30 minutos", o "mañana a las 9am".`,
        );
      }

      // Create reminder
      const reminder = await this.reminderService.createReminder(
        userId || userInfo?.userId || 'unknown',
        username || userInfo?.username || 'Usuario',
        channelId,
        reminderMessage,
        parsedTime.timestamp,
      );

      if (!reminder) {
        return createErrorResponse(
          this.name,
          'Hubo un error al guardar el recordatorio. Inténtalo de nuevo.',
        );
      }

      this.logger.log(
        { reminderId: reminder.id, username: reminder.username, dueIn: parsedTime.humanReadable },
        'Reminder created successfully',
      );

      return createSuccessResponse(
        this.name,
        `¡Listo! Te recordaré en ${parsedTime.humanReadable} sobre: "${reminderMessage}"`,
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to process reminder request');
      return createErrorResponse(
        this.name,
        'Hubo un error al procesar tu solicitud de recordatorio.',
      );
    }
  }
}
