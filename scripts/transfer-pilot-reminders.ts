import 'dotenv/config'
import Redis from 'ioredis'
import { transferLegacyReminders } from '../src/conversation/legacy-reminder-transfer'

async function main() {
  if (!process.argv.includes('--apply'))
    throw Error(
      'Explicit --apply required; stop old-version workers before transfer. See docs/reliable-reminders.md.',
    )
  const { REDIS_URL, GUILD_ID, BOT_TOKEN, CONVERSATION_PILOT_CHANNEL_IDS } = process.env
  if (!REDIS_URL || !GUILD_ID || !BOT_TOKEN || !CONVERSATION_PILOT_CHANNEL_IDS)
    throw Error('Missing configured Redis, guild, bot token or pilot channels')
  const redis = new Redis(REDIS_URL, { commandTimeout: 5000, maxRetriesPerRequest: 0 })
  try {
    console.log(
      await transferLegacyReminders(redis, {
        guildId: GUILD_ID,
        pilotChannels: CONVERSATION_PILOT_CHANNEL_IDS.split(',').map((id) => id.trim()),
        channelGuild: async (id) => {
          const response = await fetch(
            `https://discord.com/api/v10/channels/${encodeURIComponent(id)}`,
            { headers: { Authorization: `Bot ${BOT_TOKEN}` }, signal: AbortSignal.timeout(5000) },
          )
          if (!response.ok) return null
          const data = (await response.json()) as { guild_id?: string }
          return data.guild_id ?? null
        },
      }),
    )
  } finally {
    await redis.quit()
  }
}
main().catch(() => {
  console.error(
    'Transfer failed; pending records retained. Check configuration and retry the explicit operation.',
  )
  process.exitCode = 1
})
