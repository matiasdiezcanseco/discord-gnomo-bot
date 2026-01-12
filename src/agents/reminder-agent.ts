import dayjs from 'dayjs'
import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import type { Agent, AgentResponse, UserInfo } from './types.ts'
import { createSuccessResponse, createErrorResponse } from '../utils/agent-utils.ts'
import { createReminder, isReminderServiceAvailable } from '../services/reminder-service.ts'
import { getTimeParserPrompt } from '../prompts/time-parser-prompt.ts'
import { ENV } from '../config/env.ts'
import { createLogger } from '../services/logger.ts'

const log = createLogger('reminder-agent')

/**
 * Input for the reminder agent
 */
export interface ReminderInput {
  timeExpression: string
  reminderMessage: string
  channelId: string
  userId: string
  username: string
}

/**
 * Schema for AI-parsed time
 */
const timeParseSchema = z.object({
  minutes: z
    .number()
    .describe('Number of minutes from now when the reminder should trigger. Must be positive.'),
  humanReadable: z
    .string()
    .describe(
      'Human-readable description of when the reminder will trigger, in Spanish. Example: "en 2 horas", "mañana a las 9:00"',
    ),
  valid: z.boolean().describe('Whether the time expression could be parsed successfully'),
})

/**
 * Agent that handles creating reminders
 * Uses AI to parse time expressions and stores reminders in Redis
 */
export class ReminderAgent implements Agent {
  name = 'reminder-agent'

  /**
   * Parse Spanish time expression using AI
   */
  private async parseTimeExpression(
    timeExpression: string,
  ): Promise<{ timestamp: number; humanReadable: string } | null> {
    try {
      const now = dayjs()
      const currentDateTime = now.format('YYYY-MM-DD HH:mm:ss')
      const currentDayOfWeek = now.format('dddd')

      const result = await generateText({
        model: openai(ENV.OPENAI_MODEL),
        output: Output.object({
          schema: timeParseSchema,
        }),
        prompt: getTimeParserPrompt(currentDateTime, currentDayOfWeek, timeExpression),
      })

      if (!result.output.valid || result.output.minutes <= 0) {
        log.debug({ timeExpression }, 'Could not parse time expression')
        return null
      }

      const timestamp = now.add(result.output.minutes, 'minute').valueOf()

      log.debug(
        {
          timeExpression,
          minutes: result.output.minutes,
          humanReadable: result.output.humanReadable,
        },
        'Parsed time expression',
      )

      return { timestamp, humanReadable: result.output.humanReadable }
    } catch (error) {
      log.error({ err: error, timeExpression }, 'Failed to parse time expression')
      return null
    }
  }

  /**
   * Handle a reminder creation request
   * @param message JSON string containing ReminderInput
   * @param userInfo Optional user information
   */
  async handle(message: string, userInfo?: UserInfo): Promise<AgentResponse> {
    if (!isReminderServiceAvailable()) {
      log.warn('Reminder service not available')
      return createErrorResponse(
        this.name,
        'Lo siento, el servicio de recordatorios no está disponible en este momento.',
      )
    }

    try {
      const input: ReminderInput = JSON.parse(message)
      const { timeExpression, reminderMessage, channelId, userId, username } = input

      // Parse the time expression using AI
      const parsedTime = await this.parseTimeExpression(timeExpression)
      if (!parsedTime) {
        return createErrorResponse(
          this.name,
          `No pude entender el tiempo "${timeExpression}". Intenta con algo como "en 2 horas", "en 30 minutos", o "mañana a las 9am".`,
        )
      }

      // Create the reminder
      const reminder = await createReminder(
        userId || userInfo?.userId || 'unknown',
        username || userInfo?.username || 'Usuario',
        channelId,
        reminderMessage,
        parsedTime.timestamp,
      )

      if (!reminder) {
        return createErrorResponse(
          this.name,
          'Hubo un error al guardar el recordatorio. Inténtalo de nuevo.',
        )
      }

      log.info(
        { reminderId: reminder.id, username: reminder.username, dueIn: parsedTime.humanReadable },
        'Reminder created successfully',
      )

      return createSuccessResponse(
        this.name,
        `¡Listo! Te recordaré en ${parsedTime.humanReadable} sobre: "${reminderMessage}"`,
      )
    } catch (error) {
      log.error({ err: error }, 'Failed to process reminder request')
      return createErrorResponse(
        this.name,
        'Hubo un error al procesar tu solicitud de recordatorio.',
      )
    }
  }
}
