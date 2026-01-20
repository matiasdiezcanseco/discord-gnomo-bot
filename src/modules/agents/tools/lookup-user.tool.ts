import { Injectable } from '@nestjs/common';
import { userMention, type Guild } from 'discord.js';
import { BaseTool, type ToolResponse } from '../utils/base-tool';
import { findUserByNameAsync } from '../utils/user-lookup';
import { LoggerService } from '../../services/logger/logger.service';

/**
 * Tool for looking up Discord users by name
 */
@Injectable()
export class LookupUserTool extends BaseTool {
  name = 'lookup-user-tool';

  constructor(logger: LoggerService) {
    super(logger);
  }

  /**
   * Look up a user by name
   * @param input The name string to search for
   * @param guild The Discord guild to search in
   */
  protected async run(
    input: unknown,
    guild?: Guild | null,
  ): Promise<ToolResponse> {
    const name = typeof input === 'string' ? input : '';

    if (!guild) {
      return this.createErrorResponse('No hay acceso al servidor', {
        success: false,
        mention: null,
      });
    }

    const member = await findUserByNameAsync(guild, name, this.logger);

    if (member) {
      return this.createSuccessResponse(
        `Usuario encontrado: ${member.displayName}`,
        {
          success: true,
          mention: userMention(member.id),
          username: member.user.username,
          displayName: member.displayName,
        },
      );
    }

    return this.createErrorResponse(
      `No se encontró ningún usuario llamado "${name}"`,
      {
        success: false,
        mention: null,
      },
    );
  }
}
