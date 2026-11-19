import type { Capability, ReplyFile } from './catalog'
import type { ModelTurn, ToolResult } from './harness'
import { voicePlaybackNotice, type VoicePlayback } from './voice-playback'

export interface Reply {
  content: string
  allowedMentions: { parse: []; users: string[]; roles: []; repliedUser: false }
  /** Ordinary files ride on the last text/URL message; each voice file is sent alone. */
  files?: ReplyFile[]
  voicePlayback?: VoicePlayback
}
interface ReplyDraft {
  text: string
  results: readonly ToolResult[]
  files: readonly ReplyFile[]
  voicePlayback?: { playback: VoicePlayback; channelName: string }
  users: string[]
  failure?: string
  pendingWrite: boolean
}

/** One Invocación can produce several messages, but their content rules belong together. */
export class ReplyCompletion {
  constructor(private readonly tools: readonly Capability[]) {}

  /** Undefined means another model turn is needed; an empty string is a finished URL-only turn. */
  finishTurn(turn: ModelTurn, results: readonly ToolResult[]): string | undefined {
    if (!turn.calls.length) return undefined
    const exact = turn.calls.map((call) => {
      const tool = this.tools.find((entry) => entry.name === call.name)
      const result = results.find((entry) => entry.id === call.id)
      if (!tool?.verbatim || !result) return undefined
      return this.standalone(result) ? '' : tool.verbatim(result)
    })
    if (exact.some((value) => value === undefined)) return undefined
    // A standalone photo carries no model chatter around it.
    return [results.some((result) => this.standalone(result)) ? '' : turn.text, ...exact]
      .filter(Boolean)
      .join('\n')
  }

  /** Complete confirmed content before the harness authorizes and sends each message. */
  async complete(
    { text, results, files, voicePlayback, users, failure, pendingWrite }: ReplyDraft,
    synthesize?: () => Promise<string>,
  ): Promise<{ messages: Reply[]; content: string }> {
    const confirmed = results.filter((r) => r.status === 'success' || r.status === 'partial')
    // Each successful standalone result (an image URL) becomes its own message, nothing else.
    const alone = results
      .filter((result) => this.standalone(result))
      .map((result) => this.tools.find((entry) => entry.name === result.name)!.verbatim!(result))
    text = withoutStandalone(text, alone)
    // The caller owns the model and its deadline; completion owns whether it is needed.
    if (!text && confirmed.some((r) => !this.standalone(r)) && synthesize) {
      try {
        text = await synthesize()
      } catch {
        // Confirmed results still need a reply when synthesis fails.
      }
    }
    // Verbatim results are never paraphrased away: append any the final answer left out.
    // The synthesis turn may have quoted the URL again.
    text = withoutStandalone(text, alone)
    if (!text) text = voicePlaybackNotice(results)
    const exact = results
      .filter((result) => result.status === 'success' && !this.standalone(result))
      .flatMap((result) => {
        const tool = this.tools.find((entry) => entry.name === result.name)
        return tool?.verbatim ? [tool.verbatim(result)] : []
      })
      .filter((value) => !text.includes(value))
    if (exact.length) text = [text, ...exact].filter(Boolean).join('\n')
    if (!text && !alone.length && !files.length && !voicePlayback) {
      const writes = [
        ...new Set(
          confirmed
            .map((r) => this.tools.find((tool) => tool.name === r.name))
            .filter((tool) => tool?.effect === 'write')
            .map((tool) => tool!.label ?? 'completar una acción'),
        ),
      ]
      const evidence = [
        ...new Set(
          confirmed
            .filter((r) => this.tools.find((tool) => tool.name === r.name)?.effect === 'read')
            .flatMap((r) => readable(r.value)),
        ),
      ].slice(0, 15)
      text = [
        failure ??
          (results.length
            ? 'No pude completar toda la petición.'
            : 'No pude obtener una respuesta.'),
        writes.length ? `Eso sí, alcancé a ${writes.join(' y ')}.` : '',
        evidence.length ? `Lo que sí confirmé:\n${evidence.map((e) => `- ${e}`).join('\n')}\n` : '',
        'Inténtalo nuevamente en un ratito.',
      ]
        .filter(Boolean)
        .join(' ')
      if (pendingWrite || results.some((r) => r.status === 'uncertain'))
        text += '\nUna operación tiene estado incierto; no la reintentaré automáticamente.'
    }
    let chunks: string[]
    try {
      chunks = text ? splitReply(text) : []
    } catch {
      chunks = ['Una fuente excede el tamaño permitido por Discord; no pude enviarla completa.']
    }
    chunks.push(...alone)
    // Discord rejects voice messages with text or other files: each one is its own message.
    const voices = files.filter((file) => file.voice && file !== voicePlayback?.playback.file)
    const attached = files.filter((file) => !file.voice)
    // Generated files ride on the last message, or alone when there is no text at all.
    if (attached.length && !chunks.length) chunks.push('')
    const messages: Omit<Reply, 'allowedMentions'>[] = [
      ...chunks.map((content, index) =>
        attached.length && index === chunks.length - 1 ? { content, files: attached } : { content },
      ),
      ...voices.map((file) => ({ content: '', files: [file] })),
    ]
    if (voicePlayback) {
      messages.push({
        content: `Reproduciendo en ${voicePlayback.channelName}.`,
        voicePlayback: voicePlayback.playback,
      })
    }
    return {
      messages: messages.map((message) => ({
        ...message,
        allowedMentions: { parse: [], users, roles: [], repliedUser: false },
      })),
      // Text-only diagnostic summary; binary attachments never enter traces.
      content: chunks.join('\n'),
    }
  }

  private standalone(result: ToolResult): boolean {
    return (
      result.status === 'success' &&
      !!this.tools.find((tool) => tool.name === result.name && tool.verbatim && tool.standalone)
    )
  }
}

function withoutStandalone(text: string, values: readonly string[]): string {
  for (const value of values) text = text.split(value).join('').replace(/ {2,}/g, ' ').trim()
  return text
}

/** Human-readable leaves of a tool result (titles, text, URLs, names), never structure or IDs. */
function readable(value: unknown, key = ''): string[] {
  if (typeof value === 'string')
    return /(?:^|[^a-z])(?:id|ids)$|Id$|At$|^(?:source|coverage|memberCoverage|status|outcome|note|limits|fromAfter|nextAfter|after|cursor)$/.test(
      key,
    ) || !value.trim()
      ? []
      : [value.trim().replace(/\s+/g, ' ').slice(0, 300)]
  if (Array.isArray(value)) return value.flatMap((entry) => readable(entry, key))
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([entry, nested]) => readable(nested, entry))
  return []
}
/** Markdown sources and URLs are indivisible; a URL Discord cannot fit is reported explicitly. */
function splitReply(text: string): string[] {
  const tokens = text.match(/\[[^\]\n]*\]\(https?:\/\/[^\s)]+\)|https?:\/\/\S+|\s+|[^\s]+/gu) ?? []
  const chunks: string[] = []
  let current = ''
  for (const token of tokens) {
    if (token.length > 2000 && /https?:\/\//.test(token)) throw new Error('source too long')
    for (const part of token.length > 2000 ? (token.match(/[\s\S]{1,1999}/gu) ?? []) : [token]) {
      if (current.length + part.length > 2000) {
        if (current.trim()) chunks.push(current)
        current = ''
      }
      current += part
    }
  }
  if (current.trim()) chunks.push(current)
  return chunks
}
