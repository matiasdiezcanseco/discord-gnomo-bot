import { Module } from '@nestjs/common'
import { DiscordService } from './discord.service'
import { MessageHandlerService } from './message-handler.service'
import { RedisModule } from '../services/redis/redis.module'
import { LoggerModule } from '../services/logger/logger.module'
import { ConfigModule } from '../config/config.module'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { LoggerService } from '../services/logger/logger.service'
import { composeConversation } from './conversation-composition'
import { RuntimeMemory } from './runtime-memory'

@Module({
  imports: [RedisModule, LoggerModule, ConfigModule],
  providers: [
    DiscordService,
    MessageHandlerService,
    RuntimeMemory,
    {
      provide: 'CONVERSATION',
      inject: [DiscordService, ConfigService, 'REDIS_CONNECTION', LoggerService, RuntimeMemory],
      useFactory: (
        discord: DiscordService,
        config: ConfigService,
        redis: Redis | null,
        logger: LoggerService,
        memory: RuntimeMemory,
      ) =>
        composeConversation({ client: discord.getClient(), config: config, redis: redis, trace: (trace) => logger.createLogger('conversation').info(trace), memory: memory.dependencies }
        ),
    },
  ],
  exports: [DiscordService],
})
export class DiscordModule {}