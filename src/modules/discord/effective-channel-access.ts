import { ChannelType, PermissionFlagsBits, type GuildBasedChannel, type GuildMember } from 'discord.js'

/** Shared effective access only. Callers retain source policy and error classification. */
export async function effectiveChannelAccess(
  channel: GuildBasedChannel,
  requester: GuildMember,
  bot: GuildMember,
  signal?: AbortSignal,
  denyMissingThreadMember = false,
): Promise<boolean> {
  signal?.throwIfAborted()
  const read = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
  const send = channel.isThread()
    ? PermissionFlagsBits.SendMessagesInThreads
    : PermissionFlagsBits.SendMessages
  if (!channel.permissionsFor(requester)?.has(read) ||
      !channel.permissionsFor(bot)?.has([...read, send])) return false
  if (channel.isThread() && (channel.archived || channel.locked)) return false
  if (channel.type === ChannelType.PrivateThread && channel.isThread()) {
    try {
      await Promise.all([requester.id, bot.id].map(id => {
      signal?.throwIfAborted()
      return channel.members.fetch(id)
      }))
    } catch (error) {
      signal?.throwIfAborted()
      if (denyMissingThreadMember) return false
      throw error
    }
  }
  signal?.throwIfAborted()
  return true
}
