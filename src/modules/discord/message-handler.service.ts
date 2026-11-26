import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common'
import { type Message } from 'discord.js'
import { ConfigService } from '@nestjs/config'
import { LoggerService } from '../services/logger/logger.service'
import { DiscordService } from './discord.service'
import { normalizeInvocation } from './normalize-invocation'
import { isAudioAttachment } from '../../core/conversation/invocation'
import type { createConversation } from '../../conversation/harness'
import { runtimeAllows } from '../../conversation/runtime-policy'
import { describeError, reportError } from '../../diagnostics'
import { replyWithPlayback, replyWithVoice, voiceFile } from './voice-reply'
import type { AmbientReactions } from './ambient-reactions'

@Injectable()
export class MessageHandlerService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly config: ConfigService,
    private readonly discord: DiscordService,
    private readonly logger: LoggerService,
    @Inject('CONVERSATION')
    private readonly conversation: Pick<ReturnType<typeof createConversation>, 'handle'>,
    @Inject('AMBIENT_REACTIONS')
    private readonly ambient: Pick<AmbientReactions, 'observe'> | null = null,
  ) {}
  private readonly receive = (message: Message) => {
    void this.handleMessage(message).catch((error) =>
      this.logger
        .createLogger('conversation')
        .error(
          { invocationId: message.id, channelId: message.channelId, error: describeError(error) },
          'Invocation failed',
        ),
    )
  }
  onModuleInit() {
    this.discord.getClient().on('messageCreate', this.receive)
  }
  onModuleDestroy() {
    this.discord.getClient().off('messageCreate', this.receive)
  }
  async handleMessage(message: Message): Promise<void> {
    const guildId = this.config.get<string>('GUILD_ID')
    const botId = this.discord.getClient().user?.id
    const invocation = normalizeInvocation(
      message,
      guildId,
      botId,
      await this.referencedAttachments(message, guildId, botId),
    )
    if (!invocation || !runtimeAllows(this.config, invocation)) {
      const tagged = !!botId && new RegExp(`<@!?${botId}>`).test(message.content ?? '')
      // Messages addressed to the bot never count toward an unprompted reaction.
      if (!tagged && botId && guildId) this.observeAmbient(message, guildId)
      // Only messages that tag the bot: "why didn't it answer?" must be answerable from the logs.
      if (tagged)
        this.logger.createLogger('receiver').info(
          {
            invocationId: message.id,
            guildId: message.guildId,
            channelId: message.channelId,
            requesterId: message.author?.id,
            reason: message.author?.bot
              ? 'author is a bot'
              : !guildId
                ? 'GUILD_ID not configured'
                : message.guildId !== guildId
                  ? 'message from another guild'
                  : `runtime policy (RUNTIME_MODE=${this.config.get<string>('RUNTIME_MODE', 'paused')}, channel not in RUNTIME_CHANNEL_IDS?)`,
          },
          'Tagged message ignored',
        )
      return
    }
    const stopTyping = this.showTyping(message)
    try {
      await this.conversation.handle(invocation, async (_origin, reply, signal, confirmSend) => {
        stopTyping()
        if (reply.voicePlayback) {
          const { guildId, channelId } = reply.voicePlayback
          await replyWithPlayback(
            message,
            reply,
            this.discord.voiceStage,
            signal,
            (failure) =>
              this.logger
                .createLogger('voice')
                .warn(
                  { guildId, channelId, invocationId: invocation.messageId, ...failure },
                  'Voice playback failed',
                ),
            confirmSend,
          )
          return
        }
        const voice = voiceFile(reply)
        if (voice) await replyWithVoice(message, voice)
        else await message.reply(reply)
      })
    } finally {
      stopTyping()
    }
  }
  /** Fire-and-forget: an unprompted reaction is cosmetic and never delays or fails anything. */
  private observeAmbient(message: Message, guildId: string) {
    if (!this.ambient || message.author.bot || message.guildId !== guildId) return
    // Paused or outside the pilot: the countdown does not advance either.
    if (!runtimeAllows(this.config, { guildId, channelId: message.channelId })) return
    const log = this.logger.createLogger('ambient-reaction')
    const ids = { messageId: message.id, channelId: message.channelId }
    void this.ambient
      .observe({
        guildId,
        channelId: message.channelId,
        messageId: message.id,
        requester: { id: message.author.id, username: message.author.username },
        createdAt: message.createdTimestamp,
        content: message.content ?? '',
      })
      .then((outcome) => {
        if (outcome.reacted) log.info({ ...ids, emoji: outcome.emoji }, 'Ambient reaction added')
        else if (outcome.reason === 'denied' || outcome.reason === 'no-fit')
          log.info({ ...ids, reason: outcome.reason }, 'Ambient reaction skipped')
      })
      .catch((error) =>
        log.warn({ ...ids, error: describeError(error) }, 'Ambient reaction failed'),
      )
  }
  /** Same-channel attachment metadata for a tagged reply. */
  private async referencedAttachments(
    message: Message,
    guildId: string | undefined,
    botId: string | undefined,
  ) {
    const reference = message.reference
    if (
      !botId ||
      !guildId ||
      message.guildId !== guildId ||
      message.author.bot ||
      !reference?.messageId ||
      reference.channelId !== message.channelId ||
      !new RegExp(`<@!?${botId}>`).test(message.content ?? '') ||
      [...message.attachments.values()].some(isAudioAttachment)
    )
      return []
    try {
      const replied = await message.fetchReference()
      if (replied.channelId !== message.channelId) return []
      return [...replied.attachments.values()]
    } catch (error) {
      reportError('discord.reference', error, { invocationId: message.id })
      return []
    }
  }
  /** Discord shows "typing…" for ~10s per call, so it is refreshed until the reply is sent. */
  private showTyping(message: Message): () => void {
    const channel = message.channel
    if (!('sendTyping' in channel)) return () => {}
    const send = () =>
      void channel.sendTyping().catch((error) => reportError('discord.typing', error))
    send()
    const timer = setInterval(send, 8000)
    return () => clearInterval(timer)
  }
}
