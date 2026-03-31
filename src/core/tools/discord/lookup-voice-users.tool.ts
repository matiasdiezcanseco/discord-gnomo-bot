import { Injectable } from '@nestjs/common'
import { tool } from 'ai'
import { z } from 'zod'
import { userMention } from 'discord.js'
import type { Tool } from 'ai'
import type { BotTool } from '../tool.interface'
import type { BotContext } from '../../context/bot-context'
import { getUsersInVoiceChannels } from './utils/user-lookup'
import { LoggerService } from '../../../modules/services/logger/logger.service'

@Injectable()
export class LookupVoiceUsersTool implements BotTool {
  readonly name = 'lookup-voice-users'

  constructor(private readonly logger: LoggerService) {}

  build(ctx: BotContext): Record<string, Tool> {
    return {
      lookupVoiceUsers: tool({
        description:
          'Obtiene una lista de todos los usuarios que están actualmente conectados en canales de voz del servidor. Usa esto cuando el usuario quiera saber quién está en llamada o en canales de voz.',
        inputSchema: z.object({}),
        execute: async () => {
          const voiceUsers = getUsersInVoiceChannels(ctx.guild, this.logger)

          const users = voiceUsers.map((voiceUser) => ({
            mention: userMention(voiceUser.member.id),
            username: voiceUser.member.user.username,
            displayName: voiceUser.member.displayName,
            id: voiceUser.member.id,
            channelId: voiceUser.channelId,
            channelName: voiceUser.channelName,
            selfMute: voiceUser.selfMute,
            selfDeaf: voiceUser.selfDeaf,
            serverMute: voiceUser.serverMute,
            serverDeaf: voiceUser.serverDeaf,
          }))

          const usersByChannel = voiceUsers.reduce(
            (acc, voiceUser) => {
              const channelName = voiceUser.channelName || 'Canal desconocido'
              if (!acc[channelName]) {
                acc[channelName] = []
              }
              acc[channelName].push({
                mention: userMention(voiceUser.member.id),
                username: voiceUser.member.user.username,
                displayName: voiceUser.member.displayName,
              })
              return acc
            },
            {} as Record<string, Array<{ mention: string; username: string; displayName: string }>>,
          )

          return {
            success: true,
            users,
            usersByChannel,
            count: users.length,
          }
        },
      }),
    }
  }
}
