import { isAudioAttachment, type Invocation } from '../core/conversation/invocation'
import type { Budget } from './budget'
import type { Capability, ExecutionContext, ReplyFile } from './catalog'
import { PartialResult } from './catalog'
import type { ConversationPorts, ModelTurn, ToolResult, Trace } from './harness'
import { describeError } from '../diagnostics'
import type { VoicePlayback } from './voice-playback'
import { audioIntentSchema, type AudioIntent } from './audio-intent'

/** The only effect boundary. Neither model visibility nor validated input grants authorization. */
export class Executor {
  private uses = new Map<string, number>()
  private uncertain = false
  private readonly discoveredUrls = new Set<string>()
  pendingWrite = false
  /** Files from successful calls only, in call order. */
  readonly files: ReplyFile[] = []
  private readonly filesByTool = new Map<string, ReplyFile[]>()
  voicePlayback?: { playback: VoicePlayback; channelName: string }
  private readonly context: ExecutionContext
  private audioIntent?: Promise<AudioIntent | undefined>
  constructor(
    private readonly invocation: Invocation,
    private readonly tools: readonly Capability[],
    private readonly budget: Budget,
    private readonly authorize: ConversationPorts['authorize'],
    private readonly trace: (
      event: string,
      status?: string,
      tool?: string,
      extra?: Partial<Trace>,
    ) => void,
    private readonly discover = authorize,
    private readonly classifyAudio?: ConversationPorts['model']['audioIntent'],
  ) {
    this.context = {
      invocation,
      signal: budget.controller.signal,
      idempotencyKey: invocation.messageId,
      external: (work) => budget.external(work),
    }
  }
  private async allowsAudio(action: keyof AudioIntent) {
    const { classifyAudio, invocation } = this
    if (!classifyAudio) return false
    const { signal } = this.context
    this.audioIntent ??= this.budget
      .wait(() =>
        classifyAudio(
          {
            text: invocation.content,
            hasAudioAttachment:
              invocation.attachments.some(isAudioAttachment) ||
              !!invocation.referencedAudioAttachments?.some(isAudioAttachment),
          },
          signal,
        ),
      )
      .then((intent) => audioIntentSchema.parse(intent))
      .catch((error) => {
        signal.throwIfAborted()
        this.trace('audio_intent', 'unavailable', undefined, { error: describeError(error) })
        return undefined
      })
    return (await this.audioIntent)?.[action] === true
  }
  /**
   * Plays this invocation's generated speech when the request asked for it in a call but the
   * model never called voice_play. The same authorization and audio intent check apply, so a
   * voice message requested for the chat stays in the chat.
   */
  async playRequestedSpeech(): Promise<ToolResult | undefined> {
    const name = 'voice_play'
    if (
      this.voicePlayback ||
      this.uses.has(name) ||
      !this.tools.some((tool) => tool.name === name) ||
      !this.filesByTool.get('speech_generate')?.some((file) => file.voice) ||
      !(await this.allowsAudio('playGenerated'))
    )
      return undefined
    try {
      return await this.execute({ id: `chained-${name}`, name, input: { audio: 'generated' } })
    } catch (error) {
      this.context.signal.throwIfAborted()
      // Out of budget: the audio still goes out as a voice message.
      this.trace('tool_failed', 'transient', name, { error: describeError(error) })
      return undefined
    }
  }
  async available(): Promise<Capability[]> {
    const visible: Capability[] = []
    for (const tool of this.tools) {
      if (
        (await this.budget.wait(() => this.discover(this.invocation, tool, this.context.signal))) &&
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
      // Why a call never ran: the model sees only the status, the logs get the reason.
      const rejected = (status: ToolResult['status'], detail: string) => {
        this.trace('tool_rejected', status, call.name, { detail })
        return result(status)
      }
      const tool = this.tools.find((tool) => tool.name === call.name)
      if (!tool)
        return rejected('denied', `unknown tool requested by the model: ${call.name.slice(0, 60)}`)
      if (
        !(await this.budget.wait(() => this.authorize(this.invocation, tool, this.context.signal)))
      )
        return rejected(
          'denied',
          'authorization denied (runtime policy, channel access or allowlist)',
        )
      if (tool.effect === 'write' && this.uncertain)
        return rejected('uncertain', 'an earlier write is uncertain; further writes blocked')
      if (!(await this.budget.wait(() => tool.available(this.context))))
        return rejected('unavailable', 'tool not configured or dependency unavailable')
      const parsed = tool.input.safeParse(call.input)
      if (!parsed.success)
        return rejected(
          'invalid',
          parsed.error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join('.') || '(input)'}: ${issue.code}`)
            .join('; '),
        )
      const count = this.uses.get(tool.name) ?? 0
      if (count >= tool.maxCalls) return rejected('limit', `maxCalls ${tool.maxCalls} reached`)
      this.uses.set(tool.name, count + 1)
      if (
        tool.requiresAudioIntent &&
        !(await this.allowsAudio(tool.requiresAudioIntent(parsed.data)))
      )
        return rejected('denied', 'the current request did not authorize this audio action')
      this.budget.check()
      this.trace('tool_started', 'allowed', tool.name)
      this.pendingWrite = tool.effect === 'write'
      const attached: ReplyFile[] = []
      let voicePlayback: Executor['voicePlayback']
      const scoped: ExecutionContext = {
        ...this.context,
        attach: (file) => {
          attached.push(file)
        },
        generated: (toolName) =>
          Object.freeze([...(toolName ? (this.filesByTool.get(toolName) ?? []) : this.files)]),
        playVoice: (playback, channelName) => {
          voicePlayback = { playback, channelName }
        },
        discoveredUrls: Object.freeze([...this.discoveredUrls]),
        idempotencyKey: `${this.invocation.guildId}:${this.invocation.channelId}:${this.invocation.messageId}:${call.id}`,
      }
      try {
        const response = await this.budget.wait(() => tool.execute(parsed.data, scoped))
        const value = tool.output.parse(
          response instanceof PartialResult ? response.value : response,
        )
        if (JSON.stringify(value).length > tool.maxResultChars) {
          this.trace('tool_rejected', this.pendingWrite ? 'uncertain' : 'limit', tool.name, {
            detail: `result over ${tool.maxResultChars} chars`,
          })
          this.uncertain ||= this.pendingWrite
          return result(this.pendingWrite ? 'uncertain' : 'limit')
        }
        this.pendingWrite = false
        this.files.push(...attached)
        if (attached.length)
          this.filesByTool.set(tool.name, [...(this.filesByTool.get(tool.name) ?? []), ...attached])
        this.voicePlayback ??= voicePlayback
        if (['web.search', 'web.news'].includes(tool.capability)) {
          const search = value as { sources?: { url: string }[] }
          for (const source of search.sources ?? []) this.discoveredUrls.add(source.url)
        }
        // Tools that answer in prose report soft outcomes as a prefix ("unavailable: …").
        const outcome = typeof value === 'string' ? /^([a-z_]{3,20}):/.exec(value)?.[1] : undefined
        if (outcome)
          this.trace('tool_outcome', outcome, tool.name, { detail: String(value).slice(0, 200) })
        return result(
          response instanceof PartialResult ? 'partial' : value == null ? 'empty' : 'success',
          value,
        )
      } catch (error) {
        this.uncertain ||= tool.effect === 'write'
        const status =
          tool.effect === 'write'
            ? 'uncertain'
            : this.context.signal.aborted
              ? 'timeout'
              : 'transient'
        this.trace('tool_failed', status, tool.name, { error: describeError(error) })
        return result(status)
      }
    })
  }
}
