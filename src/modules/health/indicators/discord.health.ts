import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import { HealthIndicator } from '@nestjs/terminus';
import { DiscordService } from '../../discord/discord.service';

@Injectable()
export class DiscordHealthIndicator extends HealthIndicator {
  constructor(
    private readonly discordService: DiscordService,
  ) {
    super();
  }

  async isHealthy(key: string = 'discord'): Promise<HealthIndicatorResult> {
    try {
      const isReady = this.discordService.isReady();
      return this.getStatus(key, isReady);
    } catch {
      throw new HealthCheckError(
        'Discord check failed',
        this.getStatus(key, false),
      );
    }
  }
}
