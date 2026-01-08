import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import cron from 'node-cron'
import { ChannelType } from 'discord.js'
import { client } from './client.ts'
import { checkBirthdays } from './functions/check-birthdays.ts'
import { getRandomConfusedPhrase } from './functions/confused-phrases.ts'
import { AssistantAgent } from './agents/assistant-agent.ts'
import { PhraseAgent } from './agents/phrase-agent.ts'
import { ImageAgent } from './agents/image-agent.ts'
import { AgentRegistry } from './agents/types.ts'

const app = express()

app.get('/', function (_, res) {
  console.log('Health: Ok')
  res.send('Health: Ok')
})

app.listen(8080, () => {
  console.log('Server started on port 8080')
})

// Initialize agents
const agentRegistry: AgentRegistry = {
  phrase: new PhraseAgent(),
  image: new ImageAgent(),
}

const assistantAgent = new AssistantAgent(agentRegistry)

client.once('ready', () => {
  console.log(`Logged in as ${client?.user?.tag}!`)
})

cron.schedule('0 8 * * *', async () => {
  const channel = client.channels.cache.get(process.env.GNOMOS_CHANNEL_ID || '')
  if (!channel || channel.type !== ChannelType.GuildText) return
  await checkBirthdays(channel)
})

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return
  if (msg.guild?.id !== process.env.GUILD_ID) return

  console.log(msg.author.username, ' , ', msg.content)

  // Check if the bot is mentioned
  if (!client.user || !msg.mentions.has(client.user.id)) return

  // Extract message content after the bot mention
  // Discord mentions come in format <@BOT_ID> or <@!BOT_ID>
  const content = msg.content.replace(/<@!?\d+>/g, '').trim()

  // Use assistant agent to handle the message
  const response = await assistantAgent.handle(content)

  if (response.success && response.text) {
    console.log(`Handled by agent: ${response.agentName}`)
    await msg.reply(response.text)
  } else {
    await msg.reply(getRandomConfusedPhrase())
  }
})

client.login(process.env.BOT_TOKEN)
