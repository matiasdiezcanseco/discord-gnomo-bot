import { Module } from '@nestjs/common'
import { OrchestratorService } from './orchestrator.service'
import { PromptBuilder } from './prompt-builder'
import { MessageBuilder } from './message-builder'
import { ToolsModule } from '../tools/tools.module'
import { EnrichersModule } from '../enrichers/enrichers.module'
import { ConfigModule } from '../../modules/config/config.module'
import { LoggerModule } from '../../modules/services/logger/logger.module'

@Module({
  imports: [ToolsModule, EnrichersModule, ConfigModule, LoggerModule],
  providers: [PromptBuilder, MessageBuilder, OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
