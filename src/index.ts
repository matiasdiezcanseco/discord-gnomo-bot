import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import { Client } from 'discord.js'
import { generatePhrase } from './generatePhrase'
import { generateImage } from './generateImage'

const app = express()

app.get('/', function (_, res) {
  console.log('Health: Ok')
  res.send('Health: Ok')
})

app.listen(8080, () => {
  console.log('Server started on port 8080')
})

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

  const [enabler, command, extra] = msg.content.split(' ')
  if (enabler !== '-g') return

  let response = ''
  if (command === 'frase') response = generatePhrase(extra ? parseInt(extra) : undefined)
  else if (command === 'pic') response = generateImage(extra ? parseInt(extra) : undefined)

  if (response) {
    console.log(msg.author.username, ' , ', response)
    msg.reply(response)
  }
})

client.login(process.env.BOT_TOKEN)
