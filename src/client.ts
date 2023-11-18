import { Client } from 'discord.js'

export const client = new Client({
  intents: ['GuildMessages', 'Guilds', 'MessageContent'],
})
