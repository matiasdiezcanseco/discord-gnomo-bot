import type { BotContext } from '../context/bot-context'
import { getAssistantSystemPrompt } from './prompts/assistant-system-prompt'

export class PromptBuilder {
  build(ctx: BotContext): string {
    const userContext = `Estás hablando con ${ctx.userInfo.username}. `
    let prompt = getAssistantSystemPrompt(userContext)

    if (ctx.enrichedMemories && ctx.enrichedMemories.length > 0) {
      const memoriesText = ctx.enrichedMemories
        .map((r) => {
          const key = r.memory.key ? `[${r.memory.key}]` : ''
          return `- ${key} ${r.memory.content} (relevancia: ${Math.round(r.similarity * 100)}%)`
        })
        .join('\n')

      prompt += `\n\n=== MEMORIAS RELEVANTES ===\n${memoriesText}\n\nUsa esta información para enriquecer tu respuesta cuando sea relevante. No menciones que tienes estas memorias, simplemente úsalas naturalmente.`
    }

    return prompt
  }
}
