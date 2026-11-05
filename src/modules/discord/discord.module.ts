import { Module } from '@nestjs/common'
import { DiscordService } from './discord.service'
import { MessageHandlerService } from './message-handler.service'
import { OrchestratorModule } from '../../core/orchestrator/orchestrator.module'
import { RedisModule } from '../services/redis/redis.module'
import { LoggerModule } from '../services/logger/logger.module'
import { ConfigModule } from '../config/config.module'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { LoggerService } from '../services/logger/logger.service'
import { composePilot } from './pilot-conversation'
import { PilotMemory } from './pilot-memory'

@Module({
  imports: [OrchestratorModule, RedisModule, LoggerModule, ConfigModule],
  providers: [
    DiscordService,
    MessageHandlerService,
    PilotMemory,
    {
      provide: 'PILOT_CONVERSATION',
      inject: [DiscordService, ConfigService, 'REDIS_CONNECTION', LoggerService, PilotMemory],
      useFactory: (
        discord: DiscordService,
        config: ConfigService,
        redis: Redis | null,
        logger: LoggerService,
        memory: PilotMemory,
      ) =>
        composePilot(
          discord.getClient(),
          config,
          redis,
          (trace) => logger.createLogger('conversation').info(trace),
          undefined,
          undefined,
          undefined,
      memory.dependencies,
        ),
    },
  ],
  exports: [DiscordService],
})
export class DiscordModule {}
