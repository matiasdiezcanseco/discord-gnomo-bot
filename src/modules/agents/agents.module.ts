import { Module } from '@nestjs/common';
import { PhraseTool } from './tools/phrase.tool';
import { ImageTool } from './tools/image.tool';
import { LookupUserTool } from './tools/lookup-user.tool';
import { LookupAllUsersTool } from './tools/lookup-all-users.tool';
import { LookupVoiceUsersTool } from './tools/lookup-voice-users.tool';
import { WebSearchAgent } from './web-search-agent';
import { ReminderAgent } from './reminder-agent';
import { AssistantAgent } from './assistant-agent';
import { RoutingToolsService, AGENT_REGISTRY, TOOL_REGISTRY } from '../discord/routing-tools.service';
import {
  WEB_SEARCH_AGENT,
  REMINDER_AGENT,
} from './tokens/agent-tokens';
import {
  PHRASE_TOOL,
  IMAGE_TOOL,
  LOOKUP_USER_TOOL,
  LOOKUP_ALL_USERS_TOOL,
  LOOKUP_VOICE_USERS_TOOL,
} from './tokens/tool-tokens';
import { BucketModule } from '../services/bucket/bucket.module';
import { RedisModule } from '../services/redis/redis.module';
import { ReminderModule } from '../services/reminder/reminder.module';
import { LoggerModule } from '../services/logger/logger.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [
    BucketModule,
    RedisModule,
    ReminderModule,
    LoggerModule,
    ConfigModule,
  ],
  providers: [
    // Tools
    PhraseTool,
    ImageTool,
    LookupUserTool,
    LookupAllUsersTool,
    LookupVoiceUsersTool,

    // LLM Agents
    WebSearchAgent,
    ReminderAgent,
    AssistantAgent,

    // Routing Tools Service
    RoutingToolsService,

    // Agent Registry - maps string keys to LLM agents
    {
      provide: AGENT_REGISTRY,
      useFactory: (
        webSearchAgent: WebSearchAgent,
        reminderAgent: ReminderAgent,
      ) => ({
        webSearch: webSearchAgent,
        reminder: reminderAgent,
      }),
      inject: [WEB_SEARCH_AGENT, REMINDER_AGENT],
    },

    // Custom providers for agent injection tokens
    {
      provide: WEB_SEARCH_AGENT,
      useExisting: WebSearchAgent,
    },
    {
      provide: REMINDER_AGENT,
      useExisting: ReminderAgent,
    },

    // Tool Registry - maps string keys to tools
    {
      provide: TOOL_REGISTRY,
      useFactory: (
        phraseTool: PhraseTool,
        imageTool: ImageTool,
        lookupUserTool: LookupUserTool,
        lookupAllUsersTool: LookupAllUsersTool,
        lookupVoiceUsersTool: LookupVoiceUsersTool,
      ) => ({
        phrase: phraseTool,
        image: imageTool,
        lookupUser: lookupUserTool,
        lookupAllUsers: lookupAllUsersTool,
        lookupVoiceUsers: lookupVoiceUsersTool,
      }),
      inject: [
        PHRASE_TOOL,
        IMAGE_TOOL,
        LOOKUP_USER_TOOL,
        LOOKUP_ALL_USERS_TOOL,
        LOOKUP_VOICE_USERS_TOOL,
      ],
    },

    // Custom providers for tool injection tokens
    {
      provide: PHRASE_TOOL,
      useExisting: PhraseTool,
    },
    {
      provide: IMAGE_TOOL,
      useExisting: ImageTool,
    },
    {
      provide: LOOKUP_USER_TOOL,
      useExisting: LookupUserTool,
    },
    {
      provide: LOOKUP_ALL_USERS_TOOL,
      useExisting: LookupAllUsersTool,
    },
    {
      provide: LOOKUP_VOICE_USERS_TOOL,
      useExisting: LookupVoiceUsersTool,
    },
  ],
  exports: [
    AssistantAgent,
    RoutingToolsService,
    PhraseTool,
    ImageTool,
    LookupUserTool,
    LookupAllUsersTool,
    LookupVoiceUsersTool,
  ],
})
export class AgentsModule {}
