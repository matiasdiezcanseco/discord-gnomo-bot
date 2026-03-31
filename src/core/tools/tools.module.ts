import { Module } from '@nestjs/common'
import { LookupUserTool } from './discord/lookup-user.tool'
import { LookupAllUsersTool } from './discord/lookup-all-users.tool'
import { LookupVoiceUsersTool } from './discord/lookup-voice-users.tool'
import { PhraseTool } from './content/phrase.tool'
import { ImageTool } from './content/image.tool'
import { WebSearchTool } from './search/web-search.tool'
import { ReminderTool } from './reminder/reminder.tool'
import { SaveMemoryTool } from './memory/save-memory.tool'
import { QueryMemoryTool } from './memory/query-memory.tool'
import { AutoSaveMemoryTool } from './memory/auto-save-memory.tool'
import { ToolRegistryService, BOT_TOOLS } from './tool-registry.service'
import { ConfigModule } from '../../modules/config/config.module'
import { BucketModule } from '../../modules/services/bucket/bucket.module'
import { ReminderModule } from '../../modules/services/reminder/reminder.module'
import { MemoryModule } from '../../modules/services/memory/memory.module'
import { LoggerModule } from '../../modules/services/logger/logger.module'

const TOOL_CLASSES = [
  LookupUserTool,
  LookupAllUsersTool,
  LookupVoiceUsersTool,
  PhraseTool,
  ImageTool,
  WebSearchTool,
  ReminderTool,
  SaveMemoryTool,
  QueryMemoryTool,
  AutoSaveMemoryTool,
]

@Module({
  imports: [ConfigModule, BucketModule, ReminderModule, MemoryModule, LoggerModule],
  providers: [
    ...TOOL_CLASSES,
    {
      provide: BOT_TOOLS,
      useFactory: (
        lookupUser: LookupUserTool,
        lookupAllUsers: LookupAllUsersTool,
        lookupVoiceUsers: LookupVoiceUsersTool,
        phrase: PhraseTool,
        image: ImageTool,
        webSearch: WebSearchTool,
        reminder: ReminderTool,
        saveMemory: SaveMemoryTool,
        queryMemory: QueryMemoryTool,
        autoSaveMemory: AutoSaveMemoryTool,
      ) => [
        lookupUser,
        lookupAllUsers,
        lookupVoiceUsers,
        phrase,
        image,
        webSearch,
        reminder,
        saveMemory,
        queryMemory,
        autoSaveMemory,
      ],
      inject: TOOL_CLASSES,
    },
    ToolRegistryService,
  ],
  exports: [ToolRegistryService],
})
export class ToolsModule {}
