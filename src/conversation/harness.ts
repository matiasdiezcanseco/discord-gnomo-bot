import type { Invocation } from '../core/conversation/invocation'
import { Catalog, type Capability, type ExecutionContext } from './catalog'
import type { HistoryResult } from './channel-history'
import { Budget, systemClock, type Clock } from './budget'
import { splitReply } from './delivery'
import { Admission } from './admission'
import { Executor } from './executor'
import { AttachmentError, type VerifiedImage } from './attached-images'

export interface Reply {
  content: string
  allowedMentions: { parse: []; users: string[]; roles: []; repliedUser: false }
}
export interface ModelTurn {
  text: string
  calls: { id: string; name: string; input: unknown }[]
}
export type ResultStatus =
  | 'success'
  | 'empty'
  | 'partial'
  | 'denied'
  | 'unavailable'
  | 'invalid'
  | 'limit'
  | 'timeout'
  | 'transient'
  | 'uncertain'
export interface ToolResult {
  id: string
  name: string
  status: ResultStatus
  value?: unknown
}
export interface ModelInput {
  images?: VerifiedImage[]
  recentContext?: HistoryResult
  invocation: Invocation
  signal: AbortSignal
  results: ToolResult[]
  tools: readonly Capability[]
  /** Final turn: no tools remain; the model must answer from confirmed results in plain prose. */
  finalize?: boolean
}
export interface Trace {
  invocationId: string
  event: string
  tool?: string
  status?: string
  elapsedMs: number
  calls: number
  steps: number
}
export interface ConversationPorts {
  loadImages?(context: ExecutionContext): Promise<VerifiedImage[]>
  /** Called only after invocation authorization; absent means no ambient context. */
  loadContext?(context: ExecutionContext): Promise<HistoryResult | undefined>
  model: { generate(input: ModelInput): Promise<ModelTurn> }
  catalog?: Catalog
  clock?: Clock
  concurrency?: number
  authorize(invocation: Invocation, tool?: Capability, signal?: AbortSignal): Promise<boolean>
  /** Pure deployment policy for discovery after authorization; execution always reauthorizes. */
  discover?: ConversationPorts['authorize']
  claim(invocation: Invocation): Promise<boolean>
  reply(invocation: Invocation, reply: Reply): Promise<void>
  allowedUserMentions?(
    invocation: Invocation,
    context: ExecutionContext,
  ): Promise<string[] | { users: string[]; clarification?: string }>
  trace?(trace: Trace): void
  /** Main loop budget in ms (model steps and tools). */
  timeoutMs?: number
  /**
   * Grace budget for one tool-less model turn that phrases confirmed results when the loop
   * ends without a usable answer (timeout, failure, exhausted steps). 0 disables it.
   */
  synthesisTimeoutMs?: number
}

const writeLabels: Record<string, string> = {
  'memory.save': 'guardar el recuerdo',
  'memory.update': 'corregir el recuerdo',
  'memory.forget': 'olvidar el recuerdo',
  'reminders.own': 'crear el recordatorio',
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
/** Model output that is a raw data dump (JSON object/array) is never sent to Discord. */
export function looksLikeJson(text: string): boolean {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  if (!/^[[{]/.test(trimmed)) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

export function createConversation(ports: ConversationPorts) {
  const admission = new Admission(ports.concurrency ?? 4)
  return {
    async handle(source: Invocation, reply = ports.reply) {
      // A private immutable snapshot prevents adapters/tools from replacing authenticated scope.
      const invocation = Object.freeze({
        ...source,
        requester: Object.freeze({ ...source.requester }),
        attachments: source.attachments.map((a) => Object.freeze({ ...a })),
      })
      Object.freeze(invocation.attachments)
      const clock = ports.clock ?? systemClock
      const budget = new Budget(clock, clock.now(), ports.timeoutMs)
      const signal = budget.controller.signal
      const results: ToolResult[] = []
      // Attachments are untrusted data; execution still requires current text consent and permissions.
      const tools = ports.catalog?.tools ?? []
      const trace = (event: string, status?: string, tool?: string) => {
        try {
          ports.trace?.({
            invocationId: invocation.messageId,
            event,
            status,
            tool: tool
              ? tools.some((entry) => entry.name === tool)
                ? tool
                : 'unknown'
              : undefined,
            elapsedMs: clock.now() - budget.startedAt,
            calls: budget.calls,
            steps: budget.steps,
          })
        } catch {
          /* Telemetry must not affect execution. */
        }
      }
      const executor = new Executor(
        invocation,
        tools,
        budget,
        ports.authorize,
        trace,
        ports.discover,
      )
      let text = ''
      let failure: string | undefined
      let users: string[] = []
      let claimed = false
      let release: (() => void) | undefined
      try {
        trace('received')
        // Claim before any reply or effect; retain the claim even on uncertain delivery.
        claimed = await budget.wait(() => ports.claim(invocation))
        if (!claimed) {
          trace('duplicate')
          return
        }
        trace('queued')
        release = await admission.acquire(signal)
        trace('admitted')
        if (!(await budget.wait(() => ports.authorize(invocation, undefined, signal)))) {
          text = 'No tengo permiso para responder aquí.'
          trace('authorization', 'denied')
        } else {
          trace('authorization', 'allowed')
          const images = invocation.attachments.length
            ? await budget.wait(() => {
                if (!ports.loadImages)
                  throw new AttachmentError('No puedo leer adjuntos en esta configuración.')
                return ports.loadImages({
                  invocation,
                  signal,
                  idempotencyKey: invocation.messageId,
                  external: (work) => budget.external(work),
                })
              })
            : undefined
          const direct = invocation.attachments.length
            ? []
            : tools.filter((tool) => tool.direct?.matches(invocation))
          if (direct.length === 1) {
            const tool = direct[0]
            const result = await executor.execute({
              id: 'direct',
              name: tool.name,
              input: tool.direct!.input,
            })
            results.push(result)
            trace('tool_finished', result.status, result.name)
            text = tool.direct!.render(result)
          }
          const recentContext =
            direct.length === 1
              ? undefined
              : await budget.wait(
                  () =>
                    ports.loadContext?.({
                      invocation,
                      signal,
                      idempotencyKey: invocation.messageId,
                      external: (work) => budget.external(work),
                    }) ?? Promise.resolve(undefined),
                )
          for (; direct.length !== 1 && budget.steps < 5; ) {
            budget.check()
            if (
              images?.length &&
              !(await budget.wait(() => ports.authorize(invocation, undefined, signal)))
            )
              throw new AttachmentError('Se revocó el permiso para responder aquí.')
            budget.steps++
            const visible = await executor.available()
            trace('model_started')
            const turn = await budget.wait(() =>
              ports.model.generate({
                invocation,
                signal,
                results: [...results],
                tools: visible,
                recentContext,
                images,
              }),
            )
            trace('model_finished')
            if (turn.text) text = turn.text
            if (!turn.calls.length) break
            text = ''
            const run = async (call: ModelTurn['calls'][number]) => {
              const result = await executor.execute(call)
              results.push(result)
              trace('tool_finished', result.status, result.name)
            }
            // Only adjacent reads may overlap. Writes are barriers, including uncertain writes.
            for (let index = 0; index < turn.calls.length; ) {
              const batch: ModelTurn['calls'] = []
              while (
                index < turn.calls.length &&
                batch.length < 4 &&
                tools.find((tool) => tool.name === turn.calls[index].name)?.effect === 'read'
              )
                batch.push(turn.calls[index++])
              if (batch.length) await Promise.all(batch.map(run))
              else await run(turn.calls[index++])
            }
            if (budget.steps === 5) text = ''
          }
          if (ports.allowedUserMentions) {
            const resolved = await budget.wait(() =>
              ports.allowedUserMentions!(invocation, {
                invocation,
                signal,
                idempotencyKey: invocation.messageId,
                external: (work) => budget.external(work),
              }),
            )
            users = Array.isArray(resolved) ? resolved : resolved.users
            if (!Array.isArray(resolved) && resolved.clarification) text = resolved.clarification
          }
        }
      } catch (error) {
        trace('stopped', signal.aborted ? 'timeout' : 'error')
        if (!claimed) return
        if (error instanceof AttachmentError) text = error.message
        else {
          text = ''
          failure = signal.aborted
            ? 'Se agotó el tiempo disponible antes de terminar.'
            : 'Se agotó el presupuesto o falló un servicio.'
        }
      } finally {
        release?.()
        budget.close()
      }
      const confirmed = results.filter((r) => r.status === 'success' || r.status === 'partial')
      // Phrase confirmed results with one tool-less turn instead of dumping raw tool payloads.
      if (!text && confirmed.length && ports.synthesisTimeoutMs) {
        const grace = new Budget(clock, clock.now(), ports.synthesisTimeoutMs)
        try {
          trace('synthesis_started')
          const turn = await grace.wait(() =>
            ports.model.generate({
              invocation,
              signal: grace.controller.signal,
              results: [...results],
              tools: [],
              finalize: true,
            }),
          )
          if (turn.text) text = turn.text
          trace('synthesis_finished', text ? 'success' : 'empty')
        } catch {
          trace('synthesis_finished', 'error')
        } finally {
          grace.close()
        }
      }
      if (!text) {
        const writes = [
          ...new Set(
            confirmed
              .map((r) => tools.find((tool) => tool.name === r.name))
              .filter((tool) => tool?.effect === 'write')
              .map((tool) => writeLabels[tool!.capability] ?? 'completar una acción'),
          ),
        ]
        const evidence = [
          ...new Set(
            confirmed
              .filter((r) => tools.find((tool) => tool.name === r.name)?.effect === 'read')
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
        if (executor.pendingWrite || results.some((r) => r.status === 'uncertain'))
          text += '\nUna operación tiene estado incierto; no la reintentaré automáticamente.'
      }
      let chunks: string[]
      try {
        chunks = splitReply(text)
      } catch {
        chunks = ['Una fuente excede el tamaño permitido por Discord; no pude enviarla completa.']
      }
      const delivery = new Budget(clock, budget.startedAt, 15000)
      try {
        for (const content of chunks) {
          if (
            !(await delivery.wait(() =>
              ports.authorize(invocation, undefined, delivery.controller.signal),
            ))
          ) {
            trace('delivery', 'denied')
            return
          }
          await delivery.wait(() =>
            reply(invocation, {
              content,
              allowedMentions: { parse: [], users, roles: [], repliedUser: false },
            }),
          )
          trace('visible_send', 'confirmed')
        }
      } catch {
        trace('delivery', 'uncertain')
        return
      } finally {
        delivery.close()
      }
      trace('delivered')
    },
  }
}
