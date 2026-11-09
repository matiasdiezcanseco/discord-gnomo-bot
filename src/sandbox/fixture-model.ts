import type { ConversationPorts, ModelTurn } from '../conversation/harness'

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

/** Deterministic driver, explicitly not an LLM or a semantic-quality evaluation. */
export const fixtureModel: ConversationPorts['model'] = {
  async generate({ invocation, results, images }) {
    if (
      /lee la fuente/i.test(invocation.content) &&
      results.length &&
      !results.some((r) => r.name === 'web_read')
    ) {
      const source = results.find((r) => ['news_search', 'public_search'].includes(r.name))?.value
      if (
        source &&
        typeof source === 'object' &&
        'sources' in source &&
        Array.isArray(source.sources)
      ) {
        const first = source.sources[0]
        if (first && typeof first.url === 'string')
          return {
            text: '',
            calls: [{ id: 'source', name: 'web_read', input: { url: first.url } }],
          }
      }
    }
    if (results.length)
      return {
        text: `[fixture model]\n${results.map((r) => `${r.name} (${r.status}): ${JSON.stringify(r.value)}`).join('\n')}`,
        calls: [],
      }
    const text = invocation.content.toLowerCase()
    const calls: ModelTurn['calls'] = []
    const call = (name: string, input: unknown = {}) => calls.push({ id: name, name, input })
    if (/historial|contexto/.test(text)) call('messages_history', { limit: 30 })
    if (/conectad|presencia/.test(text)) call('presence_list', { limit: 25 })
    else if (/miembros|usuarios/.test(text)) call('members_list', { limit: 25 })
    if (/\bvoz\b/.test(text)) call('voice_list', { limit: 25 })
    const memory = memoryCommand(invocation.content)
    if (memory) calls.push(memory)
    else if (/recuerdos/.test(text))
      call('memory_search', { query: text.replace(/.*recuerdos:?\s*/, '') || 'prueba' })
    if (/noticias/.test(text)) {
      const today = new Date(invocation.createdAt).toISOString().slice(0, 10)
      call('news_search', {
        query: invocation.content,
        period: { startDate: today, endDate: today },
      })
    } else if (/busca en internet/.test(text)) call('public_search', { query: invocation.content })
    const url = /https?:\/\/[^\s<>]+/i.exec(invocation.content)?.[0]
    if (url) call('web_read', { url })
    if (/menciona|etiqueta|dile a/.test(text)) call('members_list', { limit: 25 })
    // Stands in for the LLM's intent judgement; only relative minutes are interpreted here.
    const reminder = /(?:recu[eé]rdame|recordatorio).*?\ben (\d+) minutos?\s*(.*)/i.exec(
      invocation.content,
    )
    if (reminder)
      call('reminder_create', {
        dueAt: new Date(invocation.createdAt + Number(reminder[1]) * 60000).toISOString(),
        text: reminder[2].trim() || 'recordatorio',
      })
    return {
      text: calls.length
        ? ''
        : images?.length
          ? `[fixture model] ${images.length} imagen(es) verificadas; el modelo fixture no interpreta su contenido.`
          : '[fixture model] Hola. Prueba frases, historial, miembros, conectados, voz, recuerdos o noticias. Usa --live-model para conversar con el modelo real.',
      calls,
    }
  },
}
