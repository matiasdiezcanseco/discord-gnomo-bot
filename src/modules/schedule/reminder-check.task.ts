import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { userMention, ChannelType } from 'discord.js';
import { ReminderService } from '../services/reminder/reminder.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../services/logger/logger.service';
import { DiscordService } from '../discord/discord.service';
import type { TextChannel } from 'discord.js';

/**
 * Task to check for due reminders and send them
 * Runs every minute
 */
@Injectable()
export class ReminderCheckTask {
  private readonly logger;

  constructor(
    private readonly discord: DiscordService,
    private readonly reminderService: ReminderService,
    private readonly config: ConfigService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.createLogger('reminder-check');
  }

  @Cron('* * * * *', { name: 'reminder-check' })
  async handleReminderCheck() {
    const currentTime = Date.now();
    const dueReminders = await this.reminderService.getDueReminders(currentTime);

    if (dueReminders.length === 0) return;

    this.logger.info({ count: dueReminders.length }, 'Processing due reminders');

    const client = this.discord.getClient();

    for (const reminder of dueReminders) {
      try {
        // Get the channel
        const channel = client.channels.cache.get(reminder.channelId);

        if (!channel) {
          this.logger.warn(
            { reminderId: reminder.id, channelId: reminder.channelId },
            'Channel not found',
          );
          await this.reminderService.deleteReminder(reminder.id);
          continue;
        }

        // Verify it's a text channel
        if (channel.type !== ChannelType.GuildText) {
          this.logger.warn(
            { reminderId: reminder.id, channelType: channel.type },
            'Channel is not a text channel',
          );
          await this.reminderService.deleteReminder(reminder.id);
          continue;
        }

        const textChannel = channel as TextChannel;

        // Build the reminder message
        const mention = userMention(reminder.userId);
        const message = `${mention} ¡Recordatorio! ${reminder.message}`;

        // Send the reminder
        await textChannel.send(message);

        this.logger.info(
          {
            reminderId: reminder.id,
            username: reminder.username,
            channelId: reminder.channelId,
          },
          'Reminder sent',
        );

        // Delete the reminder after sending
        await this.reminderService.deleteReminder(reminder.id);
      } catch (error) {
        this.logger.error(
          { err: error, reminderId: reminder.id },
          'Failed to send reminder',
        );
        // Still delete the reminder to avoid infinite retries
        await this.reminderService.deleteReminder(reminder.id);
      }
    }
  }
}
