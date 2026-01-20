import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './indicators/redis.health';
import { DiscordHealthIndicator } from './indicators/discord.health';
import { ExternalApiHealthIndicator } from './indicators/external-api.health';
import { DiscordModule } from '../discord/discord.module';
import { BucketModule } from '../services/bucket/bucket.module';

@Module({
  imports: [
    TerminusModule.forRoot({
    }),
    DiscordModule,
    BucketModule,
  ],
  controllers: [HealthController],
  providers: [
    RedisHealthIndicator,
    DiscordHealthIndicator,
    ExternalApiHealthIndicator,
  ],
})
export class HealthModule {}
