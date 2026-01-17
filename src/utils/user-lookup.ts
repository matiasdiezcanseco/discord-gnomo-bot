import type { Guild, GuildMember } from 'discord.js'
import { createLogger } from '../services/logger.ts'

const log = createLogger('user-lookup')

/**
 * Search predicate for matching a member by username or display name
 */
const matchesMember = (member: GuildMember, searchName: string): boolean =>
  member.user.username.toLowerCase() === searchName ||
  member.displayName.toLowerCase() === searchName

/**
 * Find a user in a guild by username or display name (case-insensitive)
 * @param guild The Discord guild to search in
 * @param name The username or display name to search for
 * @returns The matching GuildMember or null if not found
 */
export function findUserByName(guild: Guild, name: string): GuildMember | null {
  const searchName = name.toLowerCase().trim()
  return guild.members.cache.find((m) => matchesMember(m, searchName)) ?? null
}

/**
 * Find a user in a guild by username or display name, using search API if not cached
 * @param guild The Discord guild to search in
 * @param name The username or display name to search for
 * @returns The matching GuildMember or null if not found
 */
export async function findUserByNameAsync(guild: Guild, name: string): Promise<GuildMember | null> {
  const searchName = name.toLowerCase().trim()

  // Try cache first
  const cachedMember = findUserByName(guild, name)
  if (cachedMember) return cachedMember

  // Use search API instead of fetching all members (more efficient for large guilds)
  try {
    const members = await guild.members.search({ query: name, limit: 10 })
    return members.find((m) => matchesMember(m, searchName)) ?? null
  } catch (error) {
    log.error({ err: error, query: name }, 'Failed to search guild members')
    return null
  }
}

/**
 * Get all users in a guild
 * @param guild The Discord guild to get members from
 * @returns Array of GuildMember objects
 */
export async function getAllUsersInGuild(guild: Guild): Promise<GuildMember[]> {
  try {
    // First, try to get from cache
    const cachedMembers = Array.from(guild.members.cache.values())

    // If cache is not complete, fetch all members
    if (cachedMembers.length < guild.memberCount) {
      await guild.members.fetch()
      return Array.from(guild.members.cache.values())
    }

    return cachedMembers
  } catch (error) {
    log.error({ err: error }, 'Failed to fetch all guild members')
    // Return cached members as fallback
    return Array.from(guild.members.cache.values())
  }
}
