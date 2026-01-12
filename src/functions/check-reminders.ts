import { userMention, type Client, type TextChannel, ChannelType } from 'discord.js'
import { getDueReminders, deleteReminder } from '../services/reminder-service.ts'
import { createLogger } from '../services/logger.ts'

const log = createLogger('check-reminders')

/**
 * Check for due reminders and send them to the appropriate channels
 * This function is called by a cron job every minute
 */
export async function checkReminders(client: Client): Promise<void> {
  const currentTime = Date.now()

  // Get all reminders that are due
  const dueReminders = await getDueReminders(currentTime)

  if (dueReminders.length === 0) return

  log.info({ count: dueReminders.length }, 'Processing due reminders')

  for (const reminder of dueReminders) {
    try {
      // Get the channel
      const channel = client.channels.cache.get(reminder.channelId)

      if (!channel) {
        log.warn({ reminderId: reminder.id, channelId: reminder.channelId }, 'Channel not found')
        await deleteReminder(reminder.id)
        continue
      }

      // Verify it's a text channel
      if (channel.type !== ChannelType.GuildText) {
        log.warn(
          { reminderId: reminder.id, channelType: channel.type },
          'Channel is not a text channel',
        )
        await deleteReminder(reminder.id)
        continue
      }

      const textChannel = channel as TextChannel

      // Build the reminder message
      const mention = userMention(reminder.userId)
      const message = `${mention} ¡Recordatorio! ${reminder.message}`

      // Send the reminder
      await textChannel.send(message)

      log.info(
        {
          reminderId: reminder.id,
          username: reminder.username,
          channelId: reminder.channelId,
        },
        'Reminder sent',
      )

      // Delete the reminder after sending
      await deleteReminder(reminder.id)
    } catch (error) {
      log.error({ err: error, reminderId: reminder.id }, 'Failed to send reminder')
      // Still delete the reminder to avoid infinite retries
      await deleteReminder(reminder.id)
    }
  }
}
