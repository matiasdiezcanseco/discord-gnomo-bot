import dotenv from 'dotenv'
dotenv.config()

import cron from 'node-cron'
import { ChannelType } from 'discord.js'
import { ENV } from './config/env.ts'
import { client } from './client.ts'
import { createAssistantAgent } from './agents/agent-factory.ts'
import { startHealthServer } from './handlers/health-handler.ts'
import { handleMessage } from './handlers/message-handler.ts'
import { checkBirthdays } from './functions/check-birthdays.ts'
import { checkReminders } from './functions/check-reminders.ts'
import { createLogger } from './services/logger.ts'

const log = createLogger('main')

// Start health check server
startHealthServer()

// Initialize assistant agent
const assistantAgent = createAssistantAgent()

// Discord client ready
client.once('ready', () => {
  log.info({ tag: client?.user?.tag }, 'Discord client ready')
})

// Birthday check cron job (daily at 8 AM)
cron.schedule('0 8 * * *', async () => {
  const channel = client.channels.cache.get(ENV.GNOMOS_CHANNEL_ID)
  if (!channel || channel.type !== ChannelType.GuildText) return
  await checkBirthdays(channel)
})

// Reminder check cron job (every minute)
cron.schedule('* * * * *', async () => {
  await checkReminders(client)
})

// Message handler
client.on('messageCreate', (msg) => handleMessage(msg, client, assistantAgent))

// Start Discord client
client.login(ENV.BOT_TOKEN)
