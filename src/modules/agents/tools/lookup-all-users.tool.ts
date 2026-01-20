import { Injectable } from '@nestjs/common';
import { userMention, type Guild } from 'discord.js';
import { BaseTool, type ToolResponse } from '../utils/base-tool';
import { getAllUsersInGuild } from '../utils/user-lookup';
import { LoggerService } from '../../services/logger/logger.service';

/**
 * Tool for looking up all Discord users in a guild
 */
@Injectable()
export class LookupAllUsersTool extends BaseTool {
  name = 'lookup-all-users-tool';

  constructor(logger: LoggerService) {
    super(logger);
  }

  /**
   * Get all users in guild
   * @param guild The Discord guild to search in
   */
  protected async run(
    _input: unknown,
    guild?: Guild | null,
  ): Promise<ToolResponse> {
    if (!guild) {
      return this.createErrorResponse('No hay acceso al servidor', {
        success: false,
        users: [],
      });
    }

    const members = await getAllUsersInGuild(guild, this.logger);

    const users = members.map((member) => ({
      mention: userMention(member.id),
      username: member.user.username,
      displayName: member.displayName,
      id: member.id,
    }));

    return this.createSuccessResponse(
      `Se encontraron ${users.length} usuarios en el servidor`,
      {
        success: true,
        users,
        count: users.length,
      },
    );
  }
}
