import type { Guild, GuildMember } from 'discord.js'

/**
 * Find a user in a guild by username or display name (case-insensitive)
 * @param guild The Discord guild to search in
 * @param name The username or display name to search for
 * @returns The matching GuildMember or null if not found
 */
export function findUserByName(guild: Guild, name: string): GuildMember | null {
  const searchName = name.toLowerCase().trim()

  // Search in cached members first
  const member = guild.members.cache.find(
    (m) =>
      m.user.username.toLowerCase() === searchName || m.displayName.toLowerCase() === searchName,
  )

  return member || null
}

/**
 * Find a user in a guild by username or display name, fetching from API if needed
 * @param guild The Discord guild to search in
 * @param name The username or display name to search for
 * @returns The matching GuildMember or null if not found
 */
export async function findUserByNameAsync(guild: Guild, name: string): Promise<GuildMember | null> {
  const searchName = name.toLowerCase().trim()

  // Try cache first
  let member = findUserByName(guild, name)
  if (member) return member

  // Fetch members from API and search again
  try {
    await guild.members.fetch()
    member =
      guild.members.cache.find(
        (m) =>
          m.user.username.toLowerCase() === searchName ||
          m.displayName.toLowerCase() === searchName,
      ) ?? null
    return member
  } catch (error) {
    console.error('Error fetching guild members:', error)
    return null
  }
}
