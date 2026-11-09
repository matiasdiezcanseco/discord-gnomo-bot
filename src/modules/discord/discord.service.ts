import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { Client, GatewayIntentBits } from 'discord.js'
import { ConfigService } from '@nestjs/config'
import { LoggerService } from '../services/logger/logger.service'
import { Transport } from '../transport/transport'
import type { BirthdaySource } from '../../conversation/birthdays'
import { discordScheduledDelivery } from './scheduled-delivery'

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
      // Discord 5xx can mean acceptance is unknown. The notice dispatcher owns retry policy.
      rest: { retries: 0, timeout: 10000, rejectOnRateLimit: () => true },
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
    this.client.once('ready', () => {
      this.logger.log({ tag: this.client.user?.tag }, 'Discord client ready')
    })

    const token = this.config.get<string>('BOT_TOKEN')
    if (token && this.config.get<string>('RUNTIME_MODE', 'paused') !== 'paused')
      await this.client.login(token)
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
