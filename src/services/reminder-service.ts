import IORedis from 'ioredis'
import { ENV } from '../config/env.ts'
import { createLogger } from './logger.ts'

const log = createLogger('reminders')

/**
 * Reminder data structure
 */
export interface Reminder {
  id: string
  userId: string
  username: string
  channelId: string
  message: string
  dueTime: number
  createdAt: number
}

/**
 * Initialize Redis client for reminders
 * Uses the same REDIS_URL as the main redis service
 */
const createRedisClient = (): IORedis | null => {
  if (!ENV.REDIS_URL) {
    log.warn('REDIS_URL not configured - reminders feature disabled')
    return null
  }

  return new IORedis(ENV.REDIS_URL)
}

const redis = createRedisClient()

// Redis key constants
const REMINDERS_SORTED_SET = 'reminders:due'
const REMINDER_KEY_PREFIX = 'reminder:'

/**
 * Generate a unique reminder ID
 */
function generateReminderId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Get the Redis key for a reminder
 */
function getReminderKey(id: string): string {
  return `${REMINDER_KEY_PREFIX}${id}`
}

/**
 * Create a new reminder
 * @returns The created reminder or null on error
 */
export async function createReminder(
  userId: string,
  username: string,
  channelId: string,
  message: string,
  dueTime: number,
): Promise<Reminder | null> {
  if (!redis) {
    log.error('Cannot create reminder - Redis not configured')
    return null
  }

  try {
    const id = generateReminderId()
    const reminder: Reminder = {
      id,
      userId,
      username,
      channelId,
      message,
      dueTime,
      createdAt: Date.now(),
    }

    // Store reminder data
    await redis.set(getReminderKey(id), JSON.stringify(reminder))

    // Add to sorted set with dueTime as score for efficient querying
    await redis.zadd(REMINDERS_SORTED_SET, dueTime, id)

    log.info({ reminderId: id, username, dueTime: new Date(dueTime).toISOString() }, 'Reminder created')

    return reminder
  } catch (error) {
    log.error({ err: error }, 'Failed to create reminder')
    return null
  }
}

/**
 * Get all reminders that are due (dueTime <= currentTime)
 * @param currentTime The current timestamp in milliseconds
 * @returns Array of due reminders
 */
export async function getDueReminders(currentTime: number): Promise<Reminder[]> {
  if (!redis) return []

  try {
    // Get all reminder IDs with dueTime <= currentTime
    const reminderIds = await redis.zrangebyscore(REMINDERS_SORTED_SET, 0, currentTime)

    if (reminderIds.length === 0) return []

    // Fetch all reminder data
    const reminders: Reminder[] = []
    for (const id of reminderIds) {
      const data = await redis.get(getReminderKey(id))
      if (data) {
        try {
          reminders.push(JSON.parse(data) as Reminder)
        } catch {
          log.warn({ reminderId: id }, 'Failed to parse reminder data')
        }
      }
    }

    return reminders
  } catch (error) {
    log.error({ err: error }, 'Failed to get due reminders')
    return []
  }
}

/**
 * Delete a reminder by ID
 * @param reminderId The reminder ID to delete
 */
export async function deleteReminder(reminderId: string): Promise<void> {
  if (!redis) return

  try {
    // Remove from sorted set
    await redis.zrem(REMINDERS_SORTED_SET, reminderId)

    // Delete reminder data
    await redis.del(getReminderKey(reminderId))

    log.debug({ reminderId }, 'Reminder deleted')
  } catch (error) {
    log.error({ err: error, reminderId }, 'Failed to delete reminder')
  }
}

/**
 * Check if the reminder service is available
 */
export function isReminderServiceAvailable(): boolean {
  return redis !== null
}
