import axios from 'axios'
import dayjs from 'dayjs'
import type { Channel } from 'discord.js'

export const checkBirthdays = async (channel: Channel) => {
  try {
    const { data: birthdays } = await axios.get<{ id: number; name: string; date: string }[]>(
      process.env.BUCKET_URL + 'birthdays.json',
    )
    const today = dayjs().format('MM-DD')

    birthdays.forEach((birthday) => {
      if (birthday.date === today) {
        //@ts-ignore
        channel.send(`Feliz cumpleaños ${birthday.name}! 🎉🎉🎉`)
      }
    })
  } catch (e) {
    console.log('error', e)
  }
}
