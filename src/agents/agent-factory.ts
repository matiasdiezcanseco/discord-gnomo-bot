import type { AgentRegistry } from './types.ts'
import { AssistantAgent } from './assistant-agent.ts'
import { PhraseAgent } from './phrase-agent.ts'
import { ImageAgent } from './image-agent.ts'
import { WebSearchAgent } from './web-search-agent.ts'
import { LookupUserAgent } from './lookup-user-agent.ts'

/**
 * Create the agent registry with all specialized agents
 */
export function createAgentRegistry(): AgentRegistry {
  return {
    phrase: new PhraseAgent(),
    image: new ImageAgent(),
    webSearch: new WebSearchAgent(),
    lookupUser: new LookupUserAgent(),
  }
}

/**
 * Create the main assistant agent with all sub-agents
 */
export function createAssistantAgent(): AssistantAgent {
  const registry = createAgentRegistry()
  return new AssistantAgent(registry)
}
