import type { Guild, GuildMember } from 'discord.js';
import { LoggerService } from '../../services/logger/logger.service';

/**
 * Search predicate for matching a member by username or display name
 */
const matchesMember = (member: GuildMember, searchName: string): boolean =>
  member.user.username.toLowerCase() === searchName ||
  member.displayName.toLowerCase() === searchName;

/**
 * Find a user in a guild by username or display name (case-insensitive)
 * @param guild The Discord guild to search in
 * @param name The username or display name to search for
 * @returns The matching GuildMember or null if not found
 */
export function findUserByName(
  guild: Guild,
  name: string,
): GuildMember | null {
  const searchName = name.toLowerCase().trim();
  return guild.members.cache.find((m) => matchesMember(m, searchName)) ?? null;
}

/**
 * Find a user in a guild by username or display name, using search API if not cached
 * @param guild The Discord guild to search in
 * @param name The username or display name to search for
 * @returns The matching GuildMember or null if not found
 */
export async function findUserByNameAsync(
  guild: Guild,
  name: string,
  logger: LoggerService,
): Promise<GuildMember | null> {
  const searchName = name.toLowerCase().trim();

  // Try cache first
  const cachedMember = findUserByName(guild, name);
  if (cachedMember) return cachedMember;

  // Use search API instead of fetching all members (more efficient for large guilds)
  try {
    const members = await guild.members.search({ query: name, limit: 10 });
    return members.find((m) => matchesMember(m, searchName)) ?? null;
  } catch (error) {
    logger.error({ err: error, query: name }, 'Failed to search guild members');
    return null;
  }
}

/**
 * Get all users in a guild
 * @param guild The Discord guild to get members from
 * @returns Array of GuildMember objects
 */
export async function getAllUsersInGuild(
  guild: Guild,
  logger: LoggerService,
): Promise<GuildMember[]> {
  try {
    // First, try to get from cache
    const cachedMembers = Array.from(guild.members.cache.values());

    // If cache is not complete, fetch all members
    if (cachedMembers.length < guild.memberCount) {
      await guild.members.fetch();
      return Array.from(guild.members.cache.values());
    }

    return cachedMembers;
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch all guild members');
    // Return cached members as fallback
    return Array.from(guild.members.cache.values());
  }
}

/**
 * Information about a user in a voice channel
 */
export interface VoiceUserInfo {
  member: GuildMember;
  channelId: string;
  channelName: string | null;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
}

/**
 * Get all users currently connected to voice channels in a guild
 * @param guild The Discord guild to check
 * @returns Array of VoiceUserInfo objects
 */
export function getUsersInVoiceChannels(
  guild: Guild,
  logger: LoggerService,
): VoiceUserInfo[] {
  try {
    const voiceUsers: VoiceUserInfo[] = [];

    // Iterate through all voice states in guild
    for (const [, voiceState] of guild.voiceStates.cache) {
      // Only include users that are in a voice channel (have a channelId)
      if (voiceState.channelId && voiceState.member) {
        const channel = voiceState.channel;
        voiceUsers.push({
          member: voiceState.member,
          channelId: voiceState.channelId,
          channelName: channel?.name ?? null,
          selfMute: voiceState.mute || false,
          selfDeaf: voiceState.deaf || false,
          serverMute: voiceState.serverMute || false,
          serverDeaf: voiceState.serverDeaf || false,
        });
      }
    }

    return voiceUsers;
  } catch (error) {
    logger.error({ err: error }, 'Failed to get users in voice channels');
    return [];
  }
}
