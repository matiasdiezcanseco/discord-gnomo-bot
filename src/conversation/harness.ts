import { isAudioAttachment, type Invocation } from '../core/conversation/invocation'
import { Catalog, type Capability, type ExecutionContext } from './catalog'
import type { HistoryResult } from './channel-history'
import { Budget, systemClock, type Clock } from './budget'
import { ReplyCompletion, type Reply } from './reply-completion'
import { describeError, redact, type ErrorSummary } from '../diagnostics'
import { Admission } from './admission'
import { Executor } from './executor'
import { AttachmentError, type VerifiedImage } from './attached-images'
import { MAX_VOICE_CONNECT_TIMEOUT_MS } from '../modules/config/constants'

export type { Reply } from './reply-completion'
/** Provider facts about one model call, for diagnostics only. */
export interface ModelMeta {
  finishReason?: string
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  responseId?: string
  modelId?: string
  warnings?: string[]
}
export interface ModelTurn {
  text: string
  calls: { id: string; name: string; input: unknown }[]
  meta?: ModelMeta
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
  /** Diagnostics; never control flow. Secrets are redacted, content only when opted in. */
  durationMs?: number
  error?: ErrorSummary
  detail?: string
  model?: ModelMeta
  toolCalls?: string[]
  tools?: number
  guildId?: string
  channelId?: string
  requesterId?: string
  contentLength?: number
  attachments?: number
  parts?: number
  content?: string
  reply?: string
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
  /** Include (redacted, truncated) request and reply text in traces. Off by default. */
  traceContent?: boolean
  /** Main loop budget in ms (model steps and tools). */
  timeoutMs?: number
  /**
   * Grace budget for one tool-less model turn that phrases confirmed results when the loop
   * ends without a usable answer (timeout, failure, exhausted steps). 0 disables it.
   */
  synthesisTimeoutMs?: number
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
    async handle(
      source: Invocation,
      reply: (
        invocation: Invocation,
        reply: Reply,
        signal: AbortSignal,
      ) => Promise<void> = ports.reply,
    ) {
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
      const completion = new ReplyCompletion(tools)
      const trace = (event: string, status?: string, tool?: string, extra?: Partial<Trace>) => {
        try {
          ports.trace?.({
            ...extra,
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
        trace('received', undefined, undefined, {
          guildId: invocation.guildId,
          channelId: invocation.channelId,
          requesterId: invocation.requester.id,
          contentLength: invocation.content.length,
          attachments: invocation.attachments.length,
          ...(ports.traceContent ? { content: redact(invocation.content) } : {}),
        })
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
          const images = invocation.attachments.some((attachment) => !isAudioAttachment(attachment))
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
          const recentContext = await budget.wait(
            () =>
              ports.loadContext?.({
                invocation,
                signal,
                idempotencyKey: invocation.messageId,
                external: (work) => budget.external(work),
              }) ?? Promise.resolve(undefined),
          )
          for (; budget.steps < 5; ) {
            budget.check()
            if (
              images?.length &&
              !(await budget.wait(() => ports.authorize(invocation, undefined, signal)))
            )
              throw new AttachmentError('Se revocó el permiso para responder aquí.')
            budget.steps++
            const visible = await executor.available()
            trace('model_started', undefined, undefined, {
              tools: visible.length,
              detail: results.length ? `${results.length} tool results` : undefined,
            })
            const modelStarted = clock.now()
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
            // 'empty': the provider returned neither text nor calls (e.g. a silently incomplete response).
            trace(
              'model_finished',
              turn.text || turn.calls.length ? undefined : 'empty',
              undefined,
              {
                durationMs: clock.now() - modelStarted,
                model: turn.meta,
                toolCalls: turn.calls.map((call) => call.name),
              },
            )
            if (turn.text) text = turn.text
            if (!turn.calls.length) break
            text = ''
            const before = results.length
            const run = async (call: ModelTurn['calls'][number]) => {
              const toolStarted = clock.now()
              const result = await executor.execute(call)
              results.push(result)
              trace('tool_finished', result.status, result.name, {
                durationMs: clock.now() - toolStarted,
              })
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
            const finished = completion.finishTurn(turn, results.slice(before))
            if (finished !== undefined) {
              text = finished
              break
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
        trace('stopped', signal.aborted ? 'timeout' : 'error', undefined, {
          error: describeError(error),
        })
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
      const { messages, content } = await completion.complete(
        {
          text,
          results,
          files: executor.files,
          voicePlayback: executor.voicePlayback,
          users,
          failure,
          pendingWrite: executor.pendingWrite,
        },
        ports.synthesisTimeoutMs
          ? async () => {
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
                trace('synthesis_finished', turn.text ? 'success' : 'empty', undefined, {
                  model: turn.meta,
                })
                return turn.text
              } catch (error) {
                trace('synthesis_finished', 'error', undefined, { error: describeError(error) })
                throw error
              } finally {
                grace.close()
              }
            }
          : undefined,
      )
      // Delivery gets its own window: the processing loop and synthesis can legitimately run
      // past 15 s, and anchoring here to the request start would silently drop the reply.
      // Playback can run for the length of the clip after voice connection setup.
      const playbackDurationSecs = executor.voicePlayback?.playback.file.voice.durationSecs
      const delivery = new Budget(
        clock,
        clock.now(),
        15000 +
          (playbackDurationSecs
            ? MAX_VOICE_CONNECT_TIMEOUT_MS + Math.ceil(playbackDurationSecs * 1000)
            : 0),
      )
      try {
        for (const message of messages) {
          if (
            !(await delivery.wait(() =>
              ports.authorize(invocation, undefined, delivery.controller.signal),
            ))
          ) {
            trace('delivery', 'denied')
            return
          }
          await delivery.wait(() => reply(invocation, message, delivery.controller.signal))
          trace('visible_send', 'confirmed', undefined, {
            contentLength: message.content.length,
            ...(message.files ? { attachments: message.files.length } : {}),
          })
        }
      } catch (error) {
        trace('delivery', 'uncertain', undefined, { error: describeError(error) })
        return
      } finally {
        delivery.close()
      }
      trace('delivered', undefined, undefined, {
        parts: messages.length,
        ...(executor.files.length ? { attachments: executor.files.length } : {}),
        ...(ports.traceContent ? { reply: redact(content, 1000) } : {}),
      })
    },
  }
}
