import { userMention, type Guild } from 'discord.js'
import type { Agent, AgentResponse } from './types.ts'
import {
  createSuccessResponse,
  createErrorResponse,
  withAgentErrorHandling,
} from '../utils/agent-utils.ts'
import { getUsersInVoiceChannels } from '../utils/user-lookup.ts'

/**
 * Agent for looking up Discord users currently in voice channels
 */
export class LookupVoiceUsersAgent implements Agent {
  name = 'lookup-voice-users-agent'
  private guild: Guild | null = null

  /**
   * Set the guild to search in (must be called before handle)
   */
  setGuild(guild: Guild | null): void {
    this.guild = guild
  }

  /**
   * Get all users currently in voice channels
   * @returns AgentResponse with JSON containing array of users with mention, username, displayName, channel info
   */
  async handle(): Promise<AgentResponse> {
    return withAgentErrorHandling(this.name, async () => {
      if (!this.guild) {
        return createErrorResponse(
          this.name,
          JSON.stringify({
            success: false,
            users: [],
            message: 'No hay acceso al servidor',
          }),
        )
      }

      const voiceUsers = getUsersInVoiceChannels(this.guild)

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

      // Group users by channel for better organization
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

      return createSuccessResponse(
        this.name,
        JSON.stringify({
          success: true,
          users,
          usersByChannel,
          count: users.length,
          message:
            users.length > 0
              ? `Hay ${users.length} usuario${users.length > 1 ? 's' : ''} conectado${users.length > 1 ? 's' : ''} en canales de voz`
              : 'No hay usuarios conectados en canales de voz',
        }),
      )
    })
  }
}
