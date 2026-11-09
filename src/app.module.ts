import { Global, Module, type DynamicModule, type Type } from '@nestjs/common'
import { ConfigModule } from './modules/config/config.module'
import { LoggerModule } from './modules/services/logger/logger.module'
import { RedisModule } from './modules/services/redis/redis.module'
import { BucketModule } from './modules/services/bucket/bucket.module'
import { DiscordModule } from './modules/discord/discord.module'
import { ConsoleModule } from './modules/console/console.module'
import { ScheduleModule } from './modules/schedule/schedule.module'
import { HealthModule } from './modules/health/health.module'
import { DatabaseModule } from './database/database.module'

@Module({})
class RuntimeModule {}

/**
 * The complete bot runtime. The transport module (global, provides `Transport` and the
 * conversation) is the only part that differs between production and the local console.
 */
function runtime(transport: Type): DynamicModule {
  return {
    module: RuntimeModule,
    global: true,
    imports: [
      ConfigModule,
      DatabaseModule,
      LoggerModule.registerAsync({
        imports: [ConfigModule],
        inject: [],
        useFactory: () => ({}),
      }),
      RedisModule,
      BucketModule,
      transport,
      ScheduleModule,
      HealthModule,
    ],
  }
}

@Global()
@Module({ imports: [runtime(DiscordModule)] })
export class AppModule {}

/** Same runtime with the terminal as transport; see src/console.ts. */
@Global()
@Module({ imports: [runtime(ConsoleModule)] })
export class ConsoleAppModule {}
