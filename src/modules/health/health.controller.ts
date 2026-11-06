import { ConfigService } from '@nestjs/config'
import { Controller, Get } from '@nestjs/common'
import { HealthCheck, HealthCheckService } from '@nestjs/terminus'
import { RedisHealthIndicator } from './indicators/redis.health'
import { DiscordHealthIndicator } from './indicators/discord.health'
import { ExternalApiHealthIndicator } from './indicators/external-api.health'

@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly health: HealthCheckService,
    private readonly redis: RedisHealthIndicator,
    private readonly discord: DiscordHealthIndicator,
    private readonly externalApi: ExternalApiHealthIndicator,
  ) {}

  @Get('diagnostics')
  diagnostics() {
    return {
      runtime: this.config.get<string>('RUNTIME_MODE', 'paused'),
      model: this.config.get<string>('OPENAI_MODEL'),
      configured: Object.fromEntries(
        [
          'BOT_TOKEN',
          'REDIS_URL',
          'BUCKET_URL',
          'TAVILY_API_KEY',
          'PILOT_MEMORY_DATABASE_URL',
          'DATABASE_URL',
          'DATABASE_URL_POOLED',
          'MEMORY_OWNER_ID',
          'PILOT_MEMORY_EMBEDDING_MODEL',
        ].map((key) => [key, Boolean(this.config.get(key))]),
      ),
      migrations: 'explicit-operator-only',
    }
  }
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.redis.isHealthy(),
      () => this.discord.isHealthy(),
      () => this.externalApi.isHealthy(),
    ])
  }
}
