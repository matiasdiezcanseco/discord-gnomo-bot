import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { Client, GatewayIntentBits } from 'discord.js'
import { ConfigService } from '@nestjs/config'
import { LoggerService } from '../services/logger/logger.service'
import { Transport } from '../transport/transport'
import type { BirthdaySource } from '../../conversation/birthdays'
import { discordScheduledDelivery } from './scheduled-delivery'
import { describeError, redact } from '../../diagnostics'
import { DISCORD_REST } from './rest-policy'

@Injectable()
export class DiscordService extends Transport implements OnModuleInit, OnModuleDestroy {
  readonly name = 'discord'
  private readonly client: Client

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    super()
    this.client = new Client({
      rest: DISCORD_REST,
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates,
      ],
    })
  }

  async onModuleInit() {
    if (this.config.get<string>('GNOMO_TRANSPORT') === 'console')
      throw new Error(
        'GNOMO_TRANSPORT=console is only valid for the local console (npm run sandbox)',
      )
    const log = this.logger.createLogger('discord')
    const guildId = this.config.get<string>('GUILD_ID')
    this.client.once('ready', (client) => {
      log.info(
        {
          tag: client.user.tag,
          botId: client.user.id,
          guilds: client.guilds.cache.size,
          configuredGuildPresent: guildId ? client.guilds.cache.has(guildId) : null,
        },
        'Discord client ready',
      )
      if (guildId && !client.guilds.cache.has(guildId))
        log.error({ guildId }, 'Bot is not a member of GUILD_ID; every invocation will be ignored')
    })
    // Connection lifecycle: without these, a silent gateway drop looks like "the bot ignores me".
    this.client.on('error', (error) =>
      log.error({ error: describeError(error) }, 'Discord client error'),
    )
    this.client.on('warn', (message) =>
      log.warn({ detail: redact(message) }, 'Discord client warning'),
    )
    this.client.on('shardError', (error, shardId) =>
      log.error({ shardId, error: describeError(error) }, 'Discord gateway error'),
    )
    this.client.on('shardDisconnect', (event, shardId) =>
      log.warn({ shardId, code: event.code, reason: event.reason }, 'Discord gateway disconnected'),
    )
    this.client.on('shardReconnecting', (shardId) =>
      log.warn({ shardId }, 'Discord gateway reconnecting'),
    )
    this.client.on('shardResume', (shardId, replayed) =>
      log.info({ shardId, replayed }, 'Discord gateway resumed'),
    )
    this.client.on('invalidated', () => log.error('Discord session invalidated'))
    this.client.on('guildUnavailable', (guild) =>
      log.warn({ guildId: guild.id }, 'Guild unavailable'),
    )
    this.client.rest.on('rateLimited', (info) =>
      log.warn(
        {
          route: info.route,
          method: info.method,
          retryAfterMs: info.retryAfter,
          global: info.global,
        },
        'Discord REST rate limited',
      ),
    )

    const token = this.config.get<string>('BOT_TOKEN')
    const mode = this.config.get<string>('RUNTIME_MODE', 'paused')
    if (!token || mode === 'paused') {
      log.warn({ mode, token: !!token }, 'Not logging into Discord (paused or no BOT_TOKEN)')
      return
    }
    try {
      await this.client.login(token)
    } catch (error) {
      log.error({ error: describeError(error) }, 'Discord login failed')
      throw error
    }
  }

  async onModuleDestroy() {
    await this.client.destroy()
  }

  /**
   * Get the Discord client instance
   */
  getClient(): Client {
    return this.client
  }

  /**
   * Check if client is ready
   */
  isReady(): boolean {
    return this.client.isReady()
  }

  scheduledDelivery(source: BirthdaySource) {
    return discordScheduledDelivery(this.client, this.config, source)
  }

  /**
   * Get a channel by ID
   */
  getChannel(channelId: string) {
    return this.client.channels.cache.get(channelId)
  }
}
