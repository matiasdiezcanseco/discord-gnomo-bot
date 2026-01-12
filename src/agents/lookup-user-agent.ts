import { userMention, type Guild } from 'discord.js'
import type { Agent, AgentResponse } from './types.ts'
import { createSuccessResponse, createErrorResponse, withAgentErrorHandling } from '../utils/agent-utils.ts'
import { findUserByNameAsync } from '../utils/user-lookup.ts'

/**
 * Agent for looking up Discord users by name
 */
export class LookupUserAgent implements Agent {
  name = 'lookup-user-agent'
  private guild: Guild | null = null

  /**
   * Set the guild to search in (must be called before handle)
   */
  setGuild(guild: Guild | null): void {
    this.guild = guild
  }

  /**
   * Look up a user by name
   * @param name The username or display name to search for
   * @returns AgentResponse with JSON containing mention, username, displayName, message
   */
  async handle(name: string): Promise<AgentResponse> {
    return withAgentErrorHandling(this.name, async () => {
      if (!this.guild) {
        return createErrorResponse(this.name, JSON.stringify({
          success: false,
          mention: null,
          message: 'No hay acceso al servidor',
        }))
      }

      const member = await findUserByNameAsync(this.guild, name)

      if (member) {
        return createSuccessResponse(this.name, JSON.stringify({
          success: true,
          mention: userMention(member.id),
          username: member.user.username,
          displayName: member.displayName,
          message: `Usuario encontrado: ${member.displayName}`,
        }))
      }

      return createErrorResponse(this.name, JSON.stringify({
        success: false,
        mention: null,
        message: `No se encontró ningún usuario llamado "${name}"`,
      }))
    })
  }
}
