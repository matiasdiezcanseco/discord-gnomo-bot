import axios from 'axios'
import dayjs from 'dayjs'
import { userMention, type TextChannel } from 'discord.js'

export const checkBirthdays = async (channel: TextChannel) => {
  try {
    const { data: birthdays } = await axios.get<{ id: string; name: string; date: string }[]>(
      process.env.BUCKET_URL + 'birthdays.json',
    )
    const today = dayjs().format('MM-DD')

    birthdays.forEach((birthday) => {
      if (birthday.date === today) {
        const message = `Feliz cumpleaños ${birthday.name}! 🎉🎉🎉`
        console.log(message)
        channel.send(userMention(birthday.id))
        channel.send(message)
      }
    })
  } catch (e) {
    console.log('Error:', e)
  }
}
