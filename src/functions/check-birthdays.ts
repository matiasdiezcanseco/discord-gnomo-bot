import dayjs from 'dayjs'
import { userMention, type TextChannel } from 'discord.js'
import { fetchBucketData } from '../services/bucket-service.ts'

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
      console.log(`Birthday: ${birthday.name}`)
      await channel.send(message)
    }
  }
}
