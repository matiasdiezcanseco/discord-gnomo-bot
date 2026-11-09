import type { Logger } from 'pino'
import type { Trace } from '../../../conversation/harness'

/** Problems get a level you can filter on (`level>=40` in Fly logs); the happy path stays info. */
export function traceLevel(trace: Trace): 'error' | 'warn' | 'info' {
  if (trace.event === 'stopped' || trace.event === 'tool_failed') return 'error'
  if (trace.event === 'delivery' && trace.status === 'uncertain') return 'error'
  if (trace.event === 'synthesis_finished' && trace.status === 'error') return 'error'
  if (
    trace.status === 'empty' ||
    trace.event === 'tool_rejected' ||
    trace.event === 'tool_outcome' ||
    trace.event === 'delivery' ||
    (trace.event === 'authorization' && trace.status === 'denied') ||
    (trace.event === 'tool_finished' && trace.status !== 'success' && trace.status !== 'partial') ||
    (trace.event === 'model_finished' && trace.model?.finishReason === 'length')
  )
    return 'warn'
  return 'info'
}

export function conversationTrace(logger: Logger) {
  return (trace: Trace) => logger[traceLevel(trace)](trace, `conversation ${trace.event}`)
}
