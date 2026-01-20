import { Injectable } from '@nestjs/common';
import { userMention, type Guild } from 'discord.js';
import { BaseTool, type ToolResponse } from '../utils/base-tool';
import { getUsersInVoiceChannels } from '../utils/user-lookup';
import { LoggerService } from '../../services/logger/logger.service';

/**
 * Tool for looking up Discord users currently in voice channels
 */
@Injectable()
export class LookupVoiceUsersTool extends BaseTool {
  name = 'lookup-voice-users-tool';

  constructor(logger: LoggerService) {
    super(logger);
  }

  /**
   * Get all users currently in voice channels
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

    const voiceUsers = getUsersInVoiceChannels(guild, this.logger);

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
    }));

    // Group users by channel for better organization
    const usersByChannel = voiceUsers.reduce(
      (acc, voiceUser) => {
        const channelName = voiceUser.channelName || 'Canal desconocido';
        if (!acc[channelName]) {
          acc[channelName] = [];
        }
        acc[channelName].push({
          mention: userMention(voiceUser.member.id),
          username: voiceUser.member.user.username,
          displayName: voiceUser.member.displayName,
        });
        return acc;
      },
      {} as Record<string, Array<{ mention: string; username: string; displayName: string }>>,
    );

    const message =
      users.length > 0
        ? `Hay ${users.length} usuario${users.length > 1 ? 's' : ''} conectado${users.length > 1 ? 's' : ''} en canales de voz`
        : 'No hay usuarios conectados en canales de voz';

    return this.createSuccessResponse(message, {
      success: true,
      users,
      usersByChannel,
      count: users.length,
    });
  }
}
