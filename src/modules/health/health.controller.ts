import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { RedisHealthIndicator } from './indicators/redis.health';
import { DiscordHealthIndicator } from './indicators/discord.health';
import { ExternalApiHealthIndicator } from './indicators/external-api.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redis: RedisHealthIndicator,
    private readonly discord: DiscordHealthIndicator,
    private readonly externalApi: ExternalApiHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.redis.isHealthy(),
      () => this.discord.isHealthy(),
      () => this.externalApi.isHealthy(),
    ]);
  }
}
