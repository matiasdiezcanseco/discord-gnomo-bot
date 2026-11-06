import { Inject, Injectable, OnModuleDestroy, DynamicModule, Module, Provider, Type, ForwardReference } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

export interface RedisModuleAsyncOptions {
  imports?: (Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference<unknown>)[];
  inject?: unknown[];
  useFactory?: (...args: unknown[]) => { url?: string | null };
}

@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject('REDIS_CONNECTION') private readonly redis: IORedis | null) {}
  onModuleDestroy() { this.redis?.disconnect() }
}

@Module({})
export class RedisModule {
  static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
    const redisProvider: Provider = {
      provide: 'REDIS_CONNECTION',
      useFactory: async (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        
        if (!redisUrl) {
          return null;
        }
        
        const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 0, connectTimeout: 1000, retryStrategy: () => null });
        redis.on('error', () => undefined);
        return redis;
      },
      inject: [ConfigService],
    };

    return {
      module: RedisModule,
      imports: options.imports || [],
      providers: [redisProvider, RedisLifecycle],
      exports: ['REDIS_CONNECTION'],
      global: true,
    };
  }
}