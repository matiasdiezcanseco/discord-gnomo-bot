import { Module } from '@nestjs/common'
import { DiscordService } from './discord.service'
import { MessageHandlerService } from './message-handler.service'
import { OrchestratorModule } from '../../core/orchestrator/orchestrator.module'
import { RedisModule } from '../services/redis/redis.module'
import { LoggerModule } from '../services/logger/logger.module'
import { ConfigModule } from '../config/config.module'

@Module({
  imports: [OrchestratorModule, RedisModule, LoggerModule, ConfigModule],
  providers: [DiscordService, MessageHandlerService],
  exports: [DiscordService],
})
export class DiscordModule {}
