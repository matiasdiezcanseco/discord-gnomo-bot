import axios from 'axios'
import type { Message } from 'discord.js'

export const generateImage = async ({ message }: { message: Message<boolean> }) => {
  try {
    const { data: images } = await axios.get<string[]>(process.env.BUCKET_URL + 'images.json')
    const image = images[Math.floor(Math.random() * images.length)]

    console.log(message.author.username, ' , ', image)
    message.reply(process.env.BUCKET_URL + image)
  } catch (e) {
    console.log('Error:', e)
  }
}
