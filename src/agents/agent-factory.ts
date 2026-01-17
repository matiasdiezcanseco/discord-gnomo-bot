import type { AgentRegistry } from './types.ts'
import { AssistantAgent } from './assistant-agent.ts'
import { PhraseAgent } from './phrase-agent.ts'
import { ImageAgent } from './image-agent.ts'
import { WebSearchAgent } from './web-search-agent.ts'
import { LookupUserAgent } from './lookup-user-agent.ts'
import { LookupAllUsersAgent } from './lookup-all-users-agent.ts'
import { LookupVoiceUsersAgent } from './lookup-voice-users-agent.ts'
import { ReminderAgent } from './reminder-agent.ts'

/**
 * Create the agent registry with all specialized agents
 */
export function createAgentRegistry(): AgentRegistry {
  return {
    phrase: new PhraseAgent(),
    image: new ImageAgent(),
    webSearch: new WebSearchAgent(),
    lookupUser: new LookupUserAgent(),
    lookupAllUsers: new LookupAllUsersAgent(),
    lookupVoiceUsers: new LookupVoiceUsersAgent(),
    reminder: new ReminderAgent(),
  }
}

/**
 * Create the main assistant agent with all sub-agents
 */
export function createAssistantAgent(): AssistantAgent {
  const registry = createAgentRegistry()
  return new AssistantAgent(registry)
}
