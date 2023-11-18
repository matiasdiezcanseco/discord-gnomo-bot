import axios from 'axios'
import dayjs from 'dayjs'
import { userMention } from 'discord.js'
import type { Channel } from 'discord.js'

export const checkBirthdays = async (channel: Channel) => {
  try {
    const { data: birthdays } = await axios.get<{ id: string; name: string; date: string }[]>(
      process.env.BUCKET_URL + 'birthdays.json',
    )
    const today = dayjs().format('MM-DD')

    birthdays.forEach((birthday) => {
      if (birthday.date === today) {
        const message = `Feliz cumpleaños ${birthday.name}! 🎉🎉🎉`
        console.log(message)
        //@ts-ignore
        channel.send(userMention(birthday.id))
        //@ts-ignore
        channel.send(message)
      }
    })
  } catch (e) {
    console.log('Error:', e)
  }
}
