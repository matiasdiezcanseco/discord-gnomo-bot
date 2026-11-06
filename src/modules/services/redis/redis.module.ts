import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import IORedis from 'ioredis'
import { ConfigModule } from '../../config/config.module'

@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject('REDIS_CONNECTION') private readonly redis: IORedis | null) {}
  onModuleDestroy() {
    this.redis?.disconnect()
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    RedisLifecycle,
    {
      provide: 'REDIS_CONNECTION',
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL')
        if (!url) return null
        const redis = new IORedis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 0,
          connectTimeout: 1000,
          commandTimeout: 2000,
          enableOfflineQueue: false,
          retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
        })
        redis.on('error', () => undefined)
        try {
          await redis.connect()
        } catch {
          redis.disconnect()
          throw new Error('Redis unavailable at startup')
        }
        return redis
      },
    },
  ],
  exports: ['REDIS_CONNECTION'],
})
export class RedisModule {}
