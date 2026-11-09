import type { ConversationPorts, ModelTurn } from '../src/conversation/harness'
import type { Invocation } from '../src/core/conversation/invocation'

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

/**
 * Deterministic stand-in for the LLM's memory intent: a fixed command phrasing becomes the tool
 * call a real model would choose. Production does not parse these commands.
 */
export function memoryCommand(content: string): ModelTurn['calls'][number] | undefined {
  const text = content.trim()
  if (/[\r\n]/.test(text)) return
  const call = (name: string, input: Record<string, string | undefined>) => ({
    id: name,
    name,
    input: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
  })
  const natural = /^(?:por favor,? )?recuerda que (.{1,1200})$/iu.exec(text)
  if (natural) return call('memory_save', { content: natural[1] })
  const save = /^(?:por favor,? )?guarda recuerdo(?: \[([^\]]+)\])?: (.{1,1200})$/iu.exec(text)
  if (save) {
    const metadata: Record<string, string> = {}
    for (const field of save[1]?.split(';') ?? []) {
      const match = /^(clave|categoria|sujeto)=([^=;]{1,100})$/u.exec(field.trim())
      if (match) metadata[match[1]] = match[2]
    }
    return call('memory_save', {
      content: save[2],
      key: metadata.clave,
      category: metadata.categoria,
      subject: metadata.sujeto,
    })
  }
  const query = /^busca recuerdos:? (.{1,200})$/iu.exec(text)
  if (query) return call('memory_search', { query: query[1] })
  const update = /^corrige recuerdo ([^:\r\n]{1,100}): (.{1,1200})$/iu.exec(text)
  if (update) return call('memory_update', { selector: update[1], content: update[2] })
  const forget = /^olvida recuerdo ([^:\r\n]{1,100})$/iu.exec(text)
  if (forget) return call('memory_forget', { selector: forget[1] })
}
