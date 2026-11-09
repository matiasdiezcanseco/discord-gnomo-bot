import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { RedisModule } from '../services/redis/redis.module'
import { LoggerModule } from '../services/logger/logger.module'
import { ConfigModule } from '../config/config.module'
import { LoggerService } from '../services/logger/logger.service'
import { RuntimeMemory } from '../discord/runtime-memory'
import { Transport } from '../transport/transport'
import { composeRuntimeConversation } from '../../conversation/composition'
import { safeReader } from '../../web/safe-reader'
import { ConsoleSession } from './console-session'
import { ConsoleReceiver, ConsoleTransport } from './console-transport'

/**
 * Local transport: replaces DiscordModule only. The conversation is composed exactly as in
 * production (model, persona, tools, memory pool, Redis claims/notices, trace logging).
 */
@Global()
@Module({
  imports: [RedisModule, LoggerModule, ConfigModule],
  providers: [
    ConsoleSession,
    ConsoleTransport,
    { provide: Transport, useExisting: ConsoleTransport },
    ConsoleReceiver,
    RuntimeMemory,
    {
      provide: 'CONVERSATION',
      inject: [ConsoleSession, ConfigService, 'REDIS_CONNECTION', LoggerService, RuntimeMemory],
      useFactory: (
        session: ConsoleSession,
        config: ConfigService,
        redis: Redis | null,
        logger: LoggerService,
        memory: RuntimeMemory,
      ) => {
        if (config.get<string>('GNOMO_TRANSPORT') !== 'console')
          throw new Error('The console transport requires GNOMO_TRANSPORT=console')
        return composeRuntimeConversation({
          platform: session.platform(),
          config,
          redis,
          trace: (trace) => logger.createLogger('conversation').info(trace),
          memory: memory.dependencies,
          web: session.web(safeReader()),
        })
      },
    },
  ],
  exports: [ConsoleSession, ConsoleReceiver, Transport],
})
export class ConsoleModule {}
