import type { Invocation } from '../core/conversation/invocation'
import { Catalog, type Capability, type ExecutionContext } from './catalog'
import { Budget, systemClock, type Clock } from './budget'
import { splitReply } from './delivery'
import { Admission } from './admission'
import { Executor } from './executor'

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
  invocation: Invocation
  signal: AbortSignal
  results: ToolResult[]
  tools: readonly Capability[]
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
  model: { generate(input: ModelInput): Promise<ModelTurn> }
  catalog?: Catalog
  clock?: Clock
  concurrency?: number
  authorize(invocation: Invocation, tool?: Capability): Promise<boolean>
  claim(invocation: Invocation): Promise<boolean>
  reply(invocation: Invocation, reply: Reply): Promise<void>
  allowedUserMentions?(
    invocation: Invocation,
    context: ExecutionContext,
  ): Promise<string[] | { users: string[]; clarification?: string }>
  trace?(trace: Trace): void
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
      const clock = ports.clock ?? systemClock
      const budget = new Budget(clock, clock.now())
      const signal = budget.controller.signal
      const results: ToolResult[] = []
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
      const executor = new Executor(invocation, tools, budget, ports.authorize, trace)
      let text = ''
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
        release = await admission.acquire(signal)
        if (!(await budget.wait(() => ports.authorize(invocation)))) {
          text = 'No tengo permiso para responder aquí.'
          trace('authorization', 'denied')
        } else {
          trace('authorization', 'allowed')
          for (; budget.steps < 5; ) {
            budget.check()
            budget.steps++
            const visible = await executor.available()
            const turn = await budget.external(() =>
              ports.model.generate({ invocation, signal, results: [...results], tools: visible }),
            )
            if (turn.text) text = turn.text
            if (!turn.calls.length) break
            for (const call of turn.calls) {
              const result = await executor.execute(call)
              results.push(result)
              trace('tool_finished', result.status, result.name)
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
      } catch {
        trace('stopped', signal.aborted ? 'timeout' : 'error')
        if (!claimed) return
        text = signal.aborted
          ? 'Se agotó el tiempo disponible.'
          : 'Se agotó el presupuesto o falló un servicio.'
        const confirmed = results.filter((r) => r.status === 'success' || r.status === 'partial')
        if (confirmed.length)
          text += ` Resultados confirmados:\n${confirmed.map((r) => `${r.status === 'partial' ? 'Cobertura parcial: ' : ''}${JSON.stringify(r.value)}`).join('\n')}`
        if (executor.pendingWrite || results.some((r) => r.status === 'uncertain'))
          text += '\nUna operación tiene estado incierto; no la reintentaré automáticamente.'
      } finally {
        release?.()
        budget.close()
      }
      if (!text)
        text = results.length
          ? `No pude completar la petición: ${results.map((r) => `${r.name}: ${r.status}`).join(', ')}.`
          : 'No pude obtener una respuesta. Inténtalo nuevamente.'
      let chunks: string[]
      try {
        chunks = splitReply(text)
      } catch {
        chunks = ['Una fuente excede el tamaño permitido por Discord; no pude enviarla completa.']
      }
      const delivery = new Budget(clock, budget.startedAt, 15000)
      try {
        for (const content of chunks) {
          if (!(await delivery.wait(() => ports.authorize(invocation)))) {
            trace('delivery', 'denied')
            return
          }
          await delivery.wait(() =>
            reply(invocation, {
              content,
              allowedMentions: { parse: [], users, roles: [], repliedUser: false },
            }),
          )
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
