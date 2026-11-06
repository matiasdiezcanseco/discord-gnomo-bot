import { Global, Module } from '@nestjs/common'
import { ConfigModule } from './modules/config/config.module'
import { LoggerModule } from './modules/services/logger/logger.module'
import { RedisModule } from './modules/services/redis/redis.module'
import { BucketModule } from './modules/services/bucket/bucket.module'
import { DiscordModule } from './modules/discord/discord.module'
import { ScheduleModule } from './modules/schedule/schedule.module'
import { HealthModule } from './modules/health/health.module'

@Global()
@Module({
  imports: [
    ConfigModule,
    LoggerModule.registerAsync({
      imports: [ConfigModule],
      inject: [],
      useFactory: () => ({}),
    }),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [],
      useFactory: () => ({
        url: undefined,
      }),
    }),
    BucketModule,
    DiscordModule,
    ScheduleModule,
    HealthModule,
  ],
})
export class AppModule {}