import type { ConversationPorts, ModelTurn } from '../src/conversation/harness'
import type { Invocation } from '../src/core/conversation/invocation'
import { memoryCommand } from '../src/sandbox/fixture-model'

/**
 * Test double for the LLM: fixed memory phrasings become the tool call a real model would choose
 * from intent, and the tool's own text result is replied verbatim so tests can inspect it.
 */
export function commandModel(
  otherwise: (invocation: Invocation) => ModelTurn = () => ({ text: 'hola', calls: [] }),
): ConversationPorts['model'] {
  return {
    generate: async ({ invocation, results }) => {
      if (results.length)
        return {
          text: results
            .map((r) =>
              typeof r.value === 'string'
                ? r.value
                : `Memoria: ${r.status}. No se ha confirmado la operación.`,
            )
            .join('\n'),
          calls: [],
        }
      const call = memoryCommand(invocation.content)
      return call ? { text: '', calls: [call] } : otherwise(invocation)
    },
  }
}
