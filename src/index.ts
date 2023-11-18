import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import cron from 'node-cron'
import { client } from './client'
import { generatePhrase } from './functions/generate-phrase'
import { generateImage } from './functions/generate-image'
import { checkBirthdays } from './functions/check-birthday'

const app = express()

app.get('/', function (_, res) {
  console.log('Health: Ok')
  res.send('Health: Ok')
})

app.listen(8080, () => {
  console.log('Server started on port 8080')
})

client.once('ready', () => {
  console.log(`Logged in as ${client?.user?.tag}!`)
})

cron.schedule('0 8 * * *', async () => {
  const channel = client.channels.cache.get(process.env.GNOMOS_CHANNEL_ID || '')
  if (!channel) return
  await checkBirthdays(channel)
})

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return
  if (msg.guild?.id !== process.env.GUILD_ID) return

  console.log(msg.author.username, ' , ', msg.content)

  const [enabler, command, extra] = msg.content.split(' ')
  if (enabler !== '-g') return

  let response = ''
  if (command === 'frase') await generatePhrase({ message: msg })
  else if (command === 'pic') response = generateImage(extra ? parseInt(extra) : undefined)

  if (response) {
    console.log(msg.author.username, ' , ', response)
    msg.reply(response)
  }
})

client.login(process.env.BOT_TOKEN)
