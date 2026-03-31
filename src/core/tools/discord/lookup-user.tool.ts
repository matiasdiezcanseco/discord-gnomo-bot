import { Injectable } from '@nestjs/common'
import { tool } from 'ai'
import { z } from 'zod'
import { userMention } from 'discord.js'
import type { Tool } from 'ai'
import type { BotTool } from '../tool.interface'
import type { BotContext } from '../../context/bot-context'
import { findUserByNameAsync } from './utils/user-lookup'
import { LoggerService } from '../../../modules/services/logger/logger.service'

@Injectable()
export class LookupUserTool implements BotTool {
  readonly name = 'lookup-user'

  constructor(private readonly logger: LoggerService) {}

  build(ctx: BotContext): Record<string, Tool> {
    return {
      lookupUser: tool({
        description:
          'Busca un usuario en el servidor de Discord por su nombre de usuario o nombre visible. Usa esto cuando necesites mencionar o etiquetar a un usuario específico. Retorna la mención del usuario si lo encuentra.',
        inputSchema: z.object({
          name: z.string().describe('El nombre de usuario o nombre visible a buscar'),
        }),
        execute: async ({ name }) => {
          const member = await findUserByNameAsync(ctx.guild, name, this.logger)

          if (member) {
            return {
              success: true,
              mention: userMention(member.id),
              username: member.user.username,
              displayName: member.displayName,
            }
          }

          return {
            success: false,
            mention: null,
            message: `No se encontró ningún usuario llamado "${name}"`,
          }
        },
      }),
    }
  }
}
