import { DynamicModule, Module, Provider, Type, ForwardReference } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { RedisHistoryService } from './redis-history.service';
import { ReminderService } from '../reminder/reminder.service';

export interface RedisModuleAsyncOptions {
  imports?: (Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference<unknown>)[];
  inject?: unknown[];
  useFactory?: (...args: unknown[]) => { url?: string | null };
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
        
        return new IORedis(redisUrl);
      },
      inject: [ConfigService],
    };

    return {
      module: RedisModule,
      imports: options.imports || [],
      providers: [redisProvider, RedisHistoryService, ReminderService],
      exports: ['REDIS_CONNECTION', RedisHistoryService, ReminderService],
      global: true,
    };
  }
}
