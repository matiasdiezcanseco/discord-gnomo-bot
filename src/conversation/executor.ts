import type { Invocation } from '../core/conversation/invocation'
import type { Budget } from './budget'
import type { Capability, ExecutionContext } from './catalog'
import { PartialResult } from './catalog'
import type { ConversationPorts, ModelTurn, ToolResult } from './harness'

/** The only effect boundary. Neither model visibility nor validated input grants authorization. */
export class Executor {
  private uses = new Map<string, number>()
  private uncertain = false
  private readonly discoveredUrls = new Set<string>()
  pendingWrite = false
  private readonly context: ExecutionContext
  constructor(
    private readonly invocation: Invocation,
    private readonly tools: readonly Capability[],
    private readonly budget: Budget,
    private readonly authorize: ConversationPorts['authorize'],
    private readonly trace: (event: string, status?: string, tool?: string) => void,
    private readonly discover = authorize,
  ) {
    this.context = {
      invocation,
      signal: budget.controller.signal,
      idempotencyKey: invocation.messageId,
      external: (work) => budget.external(work),
    }
  }
  async available(): Promise<Capability[]> {
    const visible: Capability[] = []
    for (const tool of this.tools) {
      if (
        (await this.budget.wait(() => this.discover(this.invocation, tool))) &&
        (await this.budget.wait(() => tool.available(this.context)))
      )
        visible.push(tool)
    }
    return visible
  }
  async execute(call: ModelTurn['calls'][number]): Promise<ToolResult> {
    return this.budget.external(async () => {
      const result = (status: ToolResult['status'], value?: unknown): ToolResult => ({
        id: call.id,
        name: call.name,
        status,
        ...(value === undefined ? {} : { value }),
      })
      const tool = this.tools.find((tool) => tool.name === call.name)
      if (!tool || !(await this.budget.wait(() => this.authorize(this.invocation, tool))))
        return result('denied')
      if (tool.effect === 'write' && this.uncertain) return result('uncertain')
      if (!(await this.budget.wait(() => tool.available(this.context))))
        return result('unavailable')
      const parsed = tool.input.safeParse(call.input)
      if (!parsed.success) return result('invalid')
      const count = this.uses.get(tool.name) ?? 0
      if (count >= tool.maxCalls) return result('limit')
      this.uses.set(tool.name, count + 1)
      this.budget.check()
      this.trace('tool_started', 'allowed', tool.name)
      this.pendingWrite = tool.effect === 'write'
      const scoped = {
        ...this.context,
        discoveredUrls: Object.freeze([...this.discoveredUrls]),
        idempotencyKey: `${this.invocation.guildId}:${this.invocation.channelId}:${this.invocation.messageId}:${call.id}`,
      }
      try {
        const response = await this.budget.wait(() => tool.execute(parsed.data, scoped))
        const value = tool.output.parse(
          response instanceof PartialResult ? response.value : response,
        )
        if (JSON.stringify(value).length > tool.maxResultChars) {
          this.uncertain ||= this.pendingWrite
          return result(this.pendingWrite ? 'uncertain' : 'limit')
        }
        this.pendingWrite = false
        if (['web.search', 'web.news'].includes(tool.capability)) {
          const search = value as { sources?: { url: string }[] }
          for (const source of search.sources ?? []) this.discoveredUrls.add(source.url)
        }
        return result(
          response instanceof PartialResult ? 'partial' : value == null ? 'empty' : 'success',
          value,
        )
      } catch {
        this.uncertain ||= tool.effect === 'write'
        return result(
          tool.effect === 'write'
            ? 'uncertain'
            : this.context.signal.aborted
              ? 'timeout'
              : 'transient',
        )
      }
    })
  }
}
