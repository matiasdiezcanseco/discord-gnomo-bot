import { userMention, type Guild } from 'discord.js'
import type { Agent, AgentResponse } from './types.ts'
import { createSuccessResponse, createErrorResponse, withAgentErrorHandling } from '../utils/agent-utils.ts'
import { getAllUsersInGuild } from '../utils/user-lookup.ts'

/**
 * Agent for looking up all Discord users in a guild
 */
export class LookupAllUsersAgent implements Agent {
  name = 'lookup-all-users-agent'
  private guild: Guild | null = null

  /**
   * Set the guild to search in (must be called before handle)
   */
  setGuild(guild: Guild | null): void {
    this.guild = guild
  }

  /**
   * Get all users in the guild
   * @returns AgentResponse with JSON containing array of users with mention, username, displayName
   */
  async handle(): Promise<AgentResponse> {
    return withAgentErrorHandling(this.name, async () => {
      if (!this.guild) {
        return createErrorResponse(this.name, JSON.stringify({
          success: false,
          users: [],
          message: 'No hay acceso al servidor',
        }))
      }

      const members = await getAllUsersInGuild(this.guild)

      const users = members.map((member) => ({
        mention: userMention(member.id),
        username: member.user.username,
        displayName: member.displayName,
        id: member.id,
      }))

      return createSuccessResponse(this.name, JSON.stringify({
        success: true,
        users,
        count: users.length,
        message: `Se encontraron ${users.length} usuarios en el servidor`,
      }))
    })
  }
}
