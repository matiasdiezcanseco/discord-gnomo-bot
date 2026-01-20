import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Client, GatewayIntentBits } from 'discord.js';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../services/logger/logger.service';

@Injectable()
export class DiscordService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Client;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });
  }

  async onModuleInit() {
    this.client.once('ready', () => {
      this.logger.log(
        { tag: this.client.user?.tag },
        'Discord client ready',
      );
    });

    await this.client.login(this.config.get<string>('BOT_TOKEN'));
  }

  async onModuleDestroy() {
    await this.client.destroy();
  }

  /**
   * Get the Discord client instance
   */
  getClient(): Client {
    return this.client;
  }

  /**
   * Check if client is ready
   */
  isReady(): boolean {
    return this.client.isReady();
  }

  /**
   * Get a channel by ID
   */
  getChannel(channelId: string) {
    return this.client.channels.cache.get(channelId);
  }
}
