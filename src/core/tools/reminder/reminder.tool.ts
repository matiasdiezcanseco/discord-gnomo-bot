import { Injectable } from '@nestjs/common'
import { tool, generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import type { Tool } from 'ai'
import type { BotTool } from '../tool.interface'
import type { BotContext } from '../../context/bot-context'
import { ReminderService } from '../../../modules/services/reminder/reminder.service'
import { ConfigService } from '@nestjs/config'
import { getTimeParserPrompt } from './prompts/time-parser-prompt'
import { LoggerService } from '../../../modules/services/logger/logger.service'

dayjs.extend(utc)
dayjs.extend(timezone)

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
})

@Injectable()
export class ReminderTool implements BotTool {
  readonly name = 'reminder'

  constructor(
    private readonly reminderService: ReminderService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  private async parseTimeExpression(
    timeExpression: string,
  ): Promise<{ timestamp: number; humanReadable: string } | null> {
    try {
      const userTimezone = this.config.get<string>('USER_TIMEZONE', 'America/Bogota')
      const openaiModel = this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini')

      const now = dayjs().tz(userTimezone)
      const currentDateTime = now.format('YYYY-MM-DD HH:mm:ss')
      const currentDayOfWeek = now.format('dddd')

      const result = await generateText({
        model: openai(openaiModel),
        output: Output.object({
          schema: timeParseSchema,
        }),
        prompt: getTimeParserPrompt(currentDateTime, currentDayOfWeek, timeExpression),
      })

      if (!result.output.valid || result.output.minutes <= 0) {
        this.logger.debug({ timeExpression }, 'Could not parse time expression')
        return null
      }

      const timestamp = now.add(result.output.minutes, 'minute').valueOf()

      this.logger.debug(
        {
          timeExpression,
          minutes: result.output.minutes,
          humanReadable: result.output.humanReadable,
        },
        'Parsed time expression',
      )

      return { timestamp, humanReadable: result.output.humanReadable }
    } catch (error) {
      this.logger.error({ err: error, timeExpression }, 'Failed to parse time expression')
      return null
    }
  }

  build(ctx: BotContext): Record<string, Tool> {
    return {
      setReminder: tool({
        description:
          'Crea un recordatorio para el usuario. Usa esto cuando el usuario quiera que le recuerdes algo en el futuro. Ejemplos: "recuérdame en 2 horas...", "avísame mañana...", "en 30 minutos recuérdame..."',
        inputSchema: z.object({
          timeExpression: z
            .string()
            .describe(
              'La expresión de tiempo del usuario, ej: "en 2 horas", "mañana a las 9am", "en 30 minutos"',
            ),
          reminderMessage: z
            .string()
            .describe('El mensaje o cosa que el usuario quiere que le recuerdes'),
        }),
        execute: async ({ timeExpression, reminderMessage }) => {
          if (!this.reminderService.isAvailable()) {
            return { success: false, text: 'Servicio de recordatorios no disponible' }
          }

          const parsedTime = await this.parseTimeExpression(timeExpression)
          if (!parsedTime) {
            return {
              success: false,
              text: `No pude entender el tiempo "${timeExpression}". Intenta con algo como "en 2 horas", "en 30 minutos", o "mañana a las 9am".`,
            }
          }

          const reminder = await this.reminderService.createReminder(
            ctx.userInfo.userId || 'unknown',
            ctx.userInfo.username || 'Usuario',
            ctx.channel.id,
            reminderMessage,
            parsedTime.timestamp,
          )

          if (!reminder) {
            return {
              success: false,
              text: 'Hubo un error al guardar el recordatorio. Inténtalo de nuevo.',
            }
          }

          this.logger.log(
            {
              reminderId: reminder.id,
              username: reminder.username,
              dueIn: parsedTime.humanReadable,
            },
            'Reminder created successfully',
          )

          return {
            success: true,
            text: `¡Listo! Te recordaré en ${parsedTime.humanReadable} sobre: "${reminderMessage}"`,
          }
        },
      }),
    }
  }
}
