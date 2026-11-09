import { z } from 'zod'
import type { Invocation } from '../core/conversation/invocation'
import type { ToolResult } from './harness'

export class PartialResult<T> {
  constructor(readonly value: T) {}
}
/** Payload still passes the declared output schema and size limit. Include coverage/provenance in it. */
export function partialResult<T>(value: T): PartialResult<T> {
  return new PartialResult(value)
}

export interface ExecutionContext {
  readonly invocation: Invocation
  readonly signal: AbortSignal
  readonly idempotencyKey: string
  /** Structured sources from completed authorized searches in this invocation only. */
  readonly discoveredUrls?: readonly string[]
  /** Every external subcall/retry must pass through this shared budget. */
  external<T>(work: () => Promise<T>): Promise<T>
}
export interface Capability {
  name: string
  description: string
  capability: string
  scope: 'channel'
  effect: 'read' | 'write'
  input: z.ZodType
  output: z.ZodType
  maxCalls: number
  maxResultChars: number
  /**
   * The model chooses the tool by intent; its result is then delivered exactly as rendered here,
   * never rephrased by the model. A turn that only calls verbatim tools ends without another
   * model step.
   */
  verbatim?(result: ToolResult): string
  /**
   * With `verbatim`: a successful result is sent as its own message containing only that output
   * (e.g. an image URL, so Discord renders the preview). Model text never wraps it.
   */
  standalone?: boolean
  available(context: ExecutionContext): Promise<boolean>
  execute(input: unknown, context: ExecutionContext): Promise<unknown>
}

export function defineCapability<I, O>(
  definition: Omit<Capability, 'input' | 'output' | 'execute'> & {
    input: z.ZodType<I>
    output: z.ZodType<O>
    execute(input: I, context: ExecutionContext): Promise<O | PartialResult<O>>
  },
): Capability {
  return {
    ...definition,
    execute: (input, context) => definition.execute(definition.input.parse(input), context),
  }
}

export class Catalog {
  readonly tools: readonly Capability[]
  constructor(tools: Capability[] = []) {
    const names = new Set<string>()
    for (const tool of tools) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name) || names.has(tool.name))
        throw new Error('Invalid or duplicate tool name')
      if (
        !tool.description ||
        !tool.capability ||
        tool.scope !== 'channel' ||
        !['read', 'write'].includes(tool.effect) ||
        !Number.isInteger(tool.maxCalls) ||
        tool.maxCalls < 1 ||
        tool.maxCalls > 8 ||
        !Number.isInteger(tool.maxResultChars) ||
        tool.maxResultChars < 1 ||
        tool.maxResultChars > 16000
      )
        throw new Error('Invalid tool contract')
      z.toJSONSchema(tool.input)
      z.toJSONSchema(tool.output)
      names.add(tool.name)
    }
    this.tools = Object.freeze(tools.map((tool) => Object.freeze({ ...tool })))
  }
}
