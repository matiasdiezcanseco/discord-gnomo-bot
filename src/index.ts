import dotenv from 'dotenv'
dotenv.config()

import { Client } from 'discord.js'
import { generatePhrase } from './generatePhrase'
import { generateImage } from './generateImage'
const client = new Client({
  intents: ['GuildMessages', 'Guilds', 'MessageContent'],
})

client.once('ready', () => {
  console.log(`Logged in as ${client?.user?.tag}!`)
})

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return
  if (msg.guild?.id !== process.env.GUILD_ID) return

  console.log(msg.author.username, ' , ', msg.content)

  const [enabler, command] = msg.content.split(' ')
  if (enabler !== '-g') return

  let response = ''
  if (command === 'frase') response = generatePhrase()
  else if (command === 'pic') response = generateImage()

  if (response) {
    console.log(msg.author.username, ' , ', response)
    msg.reply(response)
  }
})

client.login(process.env.BOT_TOKEN)
