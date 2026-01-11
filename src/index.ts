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
import { WebSearchAgent } from './agents/web-search-agent.ts'
import { AgentRegistry, MessageHistory } from './agents/types.ts'
import { getChannelHistory, addMessage } from './services/redis-service.ts'

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
  webSearch: new WebSearchAgent(),
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

  // Extract user info and channel ID
  const userInfo = {
    username: msg.author.username,
    userId: msg.author.id,
  }
  const channelId = msg.channel.id

  // Get conversation history from Redis
  const history = await getChannelHistory(channelId)

  // Store user message in history
  const userMessage: MessageHistory = {
    role: 'user',
    username: userInfo.username,
    userId: userInfo.userId,
    content,
    timestamp: Date.now(),
  }
  await addMessage(channelId, userMessage)

  // Start typing indicator and keep it active during processing
  await msg.channel.sendTyping()
  const typingInterval = setInterval(() => {
    msg.channel.sendTyping().catch(() => clearInterval(typingInterval))
  }, 7000) // Send typing indicator every 7 seconds (expires after ~10 seconds)

  try {
    // Use assistant agent to handle the message with context
    const response = await assistantAgent.handle(content, userInfo, history)

    if (response.success && response.text) {
      console.log(`Handled by agent: ${response.agentName}`)

      // Store bot response in history
      const botMessage: MessageHistory = {
        role: 'assistant',
        username: client.user.username,
        userId: client.user.id,
        content: response.text,
        timestamp: Date.now(),
      }
      await addMessage(channelId, botMessage)

      await msg.reply(response.text)
    } else {
      await msg.reply(getRandomConfusedPhrase())
    }
  } finally {
    // Stop typing indicator
    clearInterval(typingInterval)
  }
})

client.login(process.env.BOT_TOKEN)
