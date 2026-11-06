import type { ConversationPorts, ModelTurn } from '../conversation/harness'

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
    if (/recuerdos/.test(text))
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
