import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import IORedis from 'ioredis'
import { ConfigModule } from '../../config/config.module'
import { describeError, reportError } from '../../../diagnostics'

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
        // ioredis emits one error per retry; report at most one every 30s.
        let reported = 0
        redis.on('error', (error) => {
          if (Date.now() - reported < 30000) return
          reported = Date.now()
          reportError('redis.connection', error)
        })
        try {
          await redis.connect()
        } catch (error) {
          redis.disconnect()
          const cause = describeError(error)
          throw new Error(
            `Redis unavailable at startup (${cause.code ?? cause.name}: ${cause.message})`,
          )
        }
        return redis
      },
    },
  ],
  exports: ['REDIS_CONNECTION'],
})
export class RedisModule {}
