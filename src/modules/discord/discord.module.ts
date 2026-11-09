import { conversationTrace } from '../services/logger/conversation-trace'
import { Global, Module } from '@nestjs/common'
import { Transport } from '../transport/transport'
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

/** Production transport: Discord receiver, replies and scheduled delivery. */
@Global()
@Module({
  imports: [RedisModule, LoggerModule, ConfigModule],
  providers: [
    DiscordService,
    { provide: Transport, useExisting: DiscordService },
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
        composeConversation({
          client: discord.getClient(),
          config: config,
          redis: redis,
          trace: conversationTrace(logger.createLogger('conversation')),
          memory: memory.dependencies,
        }),
    },
  ],
  exports: [DiscordService, Transport],
})
export class DiscordModule {}
