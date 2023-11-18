import axios from 'axios'
import type { Message } from 'discord.js'

export const generatePhrase = async ({ message }: { message: Message<boolean> }) => {
  try {
    const { data: phrases } = await axios.get<string[]>(process.env.BUCKET_URL + 'phrases.json')
    const phrase = phrases[Math.floor(Math.random() * phrases.length)]

    console.log(message.author.username, ' , ', phrase)
    message.reply(phrase)
  } catch (e) {
    console.log('Error:', e)
  }
}
