import { Pool } from 'pg'
import { embed } from 'ai'
import { openai } from '@ai-sdk/openai'
import { migrateLegacy, type MigrationAction } from './service'
import { databasePoolConfig } from '../database/configuration'

/** Same entry point used by the executable; only external HTTP/output are injectable. */
export async function migrationCli(
  args: string[],
  env: Record<string, string | undefined> = process.env,
  discordFetch: typeof fetch = fetch,
  report: (text: string) => void = console.log,
) {
  if (args.length !== 1 || !['dry-run', 'backup', 'import', 'rollback'].includes(args[0]))
    throw new Error('Usage: npm run memory:migrate -- dry-run|backup|import|rollback')
  for (const key of ['GUILD_ID', 'GNOMOS_CHANNEL_ID', 'BOT_TOKEN'])
    if (!env[key]) throw new Error(`Missing ${key}`)
  const options = databasePoolConfig(env, 'migration')
  if (!options) throw new Error('Missing DATABASE_URL (or PILOT_MEMORY_DATABASE_URL)')
  const pool = new Pool(options)
  pool.on('error', () => undefined)
  const model = env.PILOT_MEMORY_EMBEDDING_MODEL
  try {
    report(
      JSON.stringify(
        await migrateLegacy(
          {
            pool,
            guildId: env.GUILD_ID!,
            channelId: env.GNOMOS_CHANNEL_ID!,
            destination: async () => {
              const response = await discordFetch(
                `https://discord.com/api/v10/channels/${env.GNOMOS_CHANNEL_ID}`,
                {
                  headers: { Authorization: `Bot ${env.BOT_TOKEN}` },
                  signal: AbortSignal.timeout(5000),
                  redirect: 'error',
                },
              )
              if (!response.ok) throw new Error('Discord destination validation failed')
              const channel = (await response.json()) as {
                id: string
                guild_id?: string
                type: number
              }
              if (![0, 5, 10, 11, 12].includes(channel.type))
                throw new Error('Destination is not a guild text channel')
              return { channelId: channel.id, guildId: channel.guild_id ?? null }
            },
            approveNullGuild: env.MEMORY_MIGRATION_APPROVE_NULL_GUILD === 'true',
            legacyModel: env.MEMORY_MIGRATION_LEGACY_MODEL,
            model,
            dimensions: env.MEMORY_MIGRATION_DIMENSIONS
              ? Number(env.MEMORY_MIGRATION_DIMENSIONS)
              : undefined,
            lexicalOnly: env.MEMORY_MIGRATION_LEXICAL_ONLY === 'true',
            embedding: model
              ? {
                  model,
                  embed: async (value, signal) =>
                    (
                      await embed({
                        model: openai.embedding(model),
                        value,
                        abortSignal: signal,
                        maxRetries: 0,
                      })
                    ).embedding,
                }
              : undefined,
          },
          args[0] as MigrationAction,
        ),
      ),
    )
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  migrationCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Migration failed')
    process.exitCode = 1
  })
}
