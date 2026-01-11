import dayjs from 'dayjs'
import { userMention, type TextChannel } from 'discord.js'
import { fetchBucketData } from '../services/bucket-service.ts'
import { createLogger } from '../services/logger.ts'

const log = createLogger('birthdays')

interface Birthday {
  id: string
  name: string
  date: string
}

export const checkBirthdays = async (channel: TextChannel): Promise<void> => {
  const birthdays = await fetchBucketData<Birthday[]>('birthdays.json')
  if (!birthdays) return

  const today = dayjs().format('MM-DD')

  for (const birthday of birthdays) {
    if (birthday.date === today) {
      const message = `${userMention(birthday.id)} Feliz cumpleaños ${birthday.name}! 🎉🎉🎉`
      log.info({ name: birthday.name, userId: birthday.id }, 'Sending birthday message')
      await channel.send(message)
    }
  }
}
