import { Injectable } from '@nestjs/common'
import { tool } from 'ai'
import { z } from 'zod'
import { userMention } from 'discord.js'
import type { Tool } from 'ai'
import type { BotTool } from '../tool.interface'
import type { BotContext } from '../../context/bot-context'
import { getAllUsersInGuild } from './utils/user-lookup'
import { LoggerService } from '../../../modules/services/logger/logger.service'

@Injectable()
export class LookupAllUsersTool implements BotTool {
  readonly name = 'lookup-all-users'

  constructor(private readonly logger: LoggerService) {}

  build(ctx: BotContext): Record<string, Tool> {
    return {
      lookupAllUsers: tool({
        description:
          'Obtiene una lista de todos los usuarios en el servidor de Discord. Usa esto cuando el usuario quiera ver todos los miembros del servidor o necesites información sobre todos los usuarios.',
        inputSchema: z.object({}),
        execute: async () => {
          const members = await getAllUsersInGuild(ctx.guild, this.logger)

          const users = members.map((member) => ({
            mention: userMention(member.id),
            username: member.user.username,
            displayName: member.displayName,
            id: member.id,
          }))

          return {
            success: true,
            users,
            count: users.length,
          }
        },
      }),
    }
  }
}
