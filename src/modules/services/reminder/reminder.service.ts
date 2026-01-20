import { Injectable, Inject } from '@nestjs/common';
import IORedis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';

/**
 * Reminder data structure
 */
export interface Reminder {
  id: string;
  userId: string;
  username: string;
  channelId: string;
  message: string;
  dueTime: number;
  createdAt: number;
}

@Injectable()
export class ReminderService {
  constructor(
    @Inject('REDIS_CONNECTION') private readonly redis: IORedis | null,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    if (!redis) {
      logger.log(
        'REDIS_URL not configured - reminders feature disabled',
      );
    }
  }

  // Redis key constants
  private readonly REMINDERS_SORTED_SET = 'reminders:due';
  private readonly REMINDER_KEY_PREFIX = 'reminder:';

  /**
   * Generate a unique reminder ID
   */
  private generateReminderId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get the Redis key for a reminder
   */
  private getReminderKey(id: string): string {
    return `${this.REMINDER_KEY_PREFIX}${id}`;
  }

  /**
   * Check if the reminder service is available
   */
  isAvailable(): boolean {
    return this.redis !== null;
  }

  /**
   * Create a new reminder
   * @returns The created reminder or null on error
   */
  async createReminder(
    userId: string,
    username: string,
    channelId: string,
    message: string,
    dueTime: number,
  ): Promise<Reminder | null> {
    if (!this.redis) {
      this.logger.error(
        'Cannot create reminder - Redis not configured',
        'reminders',
      );
      return null;
    }

    try {
      const id = this.generateReminderId();
      const reminder: Reminder = {
        id,
        userId,
        username,
        channelId,
        message,
        dueTime,
        createdAt: Date.now(),
      };

      // Store reminder data
      await this.redis.set(this.getReminderKey(id), JSON.stringify(reminder));

      // Add to sorted set with dueTime as score for efficient querying
      await this.redis.zadd(this.REMINDERS_SORTED_SET, dueTime, id);

      this.logger.log(
        { reminderId: id, username, dueTime: new Date(dueTime).toISOString() },
        'Reminder created',
      );

      return reminder;
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to create reminder', 'reminders');
      return null;
    }
  }

  /**
   * Get all reminders that are due (dueTime <= currentTime)
   * @param currentTime The current timestamp in milliseconds
   * @returns Array of due reminders
   */
  async getDueReminders(currentTime: number): Promise<Reminder[]> {
    if (!this.redis) return [];

    try {
      // Get all reminder IDs with dueTime <= currentTime
      const reminderIds = await this.redis.zrangebyscore(
        this.REMINDERS_SORTED_SET,
        0,
        currentTime,
      );

      if (reminderIds.length === 0) return [];

      // Fetch all reminder data
      const reminders: Reminder[] = [];
      for (const id of reminderIds) {
        const data = await this.redis.get(this.getReminderKey(id));
        if (data) {
          try {
            reminders.push(JSON.parse(data) as Reminder);
          } catch {
            this.logger.log(
              { reminderId: id },
              'Failed to parse reminder data',
            );
          }
        }
      }

      return reminders;
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to get due reminders', 'reminders');
      return [];
    }
  }

  /**
   * Delete a reminder by ID
   * @param reminderId The reminder ID to delete
   */
  async deleteReminder(reminderId: string): Promise<void> {
    if (!this.redis) return;

    try {
      // Remove from sorted set
      await this.redis.zrem(this.REMINDERS_SORTED_SET, reminderId);

      // Delete reminder data
      await this.redis.del(this.getReminderKey(reminderId));

      this.logger.debug({ reminderId }, 'Reminder deleted');
    } catch (error) {
      this.logger.error(
        { err: error, reminderId },
        'Failed to delete reminder',
        'reminders',
      );
    }
  }
}
