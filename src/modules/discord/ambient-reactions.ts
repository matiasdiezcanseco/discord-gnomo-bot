import type { Client } from 'discord.js'
import type { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { openai } from '@ai-sdk/openai'
import type { Invocation } from '../../core/conversation/invocation'
import type { ExecutionContext } from '../../conversation/catalog'
import { runtimeAllows } from '../../conversation/runtime-policy'
import {
  aiSdkEmojiChooser,
  ambientReactions,
  redisReactionCountdown,
  type AmbientMessage,
  type EmojiChooser,
  type ReactionCountdown,
} from '../../conversation/ambient-reactions'
import { runtimeSettings } from '../config/runtime-settings'
import { discordPlatform } from './conversation-composition'
import { discordReactions } from './reactions'

export interface AmbientReactionComposition {
  client: Client
  config: ConfigService
  redis: Redis | null
  discordFetch?: typeof fetch
  choose?: EmojiChooser
  countdown?: ReactionCountdown
}

function asInvocation(message: AmbientMessage): Invocation {
  return { ...message, attachments: [] }
}

function context(message: AmbientMessage, signal: AbortSignal): ExecutionContext {
  return {
    invocation: asInvocation(message),
    signal,
    idempotencyKey: `ambient-reaction:${message.messageId}`,
    external: (work) => work(),
  }
}

/** Off (undefined) without whitelisted channels, Redis for the countdown, or a model key. */
export function discordAmbientReactions({
  client,
  config,
  redis,
  discordFetch = fetch,
  choose,
  countdown,
}: AmbientReactionComposition) {
  const settings = runtimeSettings(config)
  if (!settings.ambientReactionChannelIds.size || !redis) return undefined
  const chooser =
    choose ??
    (settings.openaiApiKey
      ? aiSdkEmojiChooser(openai(settings.model), settings.reasoningEffort)
      : undefined)
  if (!chooser) return undefined
  const platform = discordPlatform(client, discordFetch)
  // Same gate as a tagged request: deployment policy, then live channel access for author and bot.
  const authorize = async (invocation: Invocation, signal?: AbortSignal) =>
    runtimeAllows(config, invocation) && platform.access(invocation, signal)
  const reactions = discordReactions(client, authorize, discordFetch)
  return ambientReactions({
    channelIds: settings.ambientReactionChannelIds,
    countdown: countdown ?? redisReactionCountdown(redis),
    allowed: (message, signal) => authorize(asInvocation(message), signal),
    listEmojis: async (message, signal) =>
      (await reactions.list(context(message, signal))).emojis.map(({ emoji, name }) => ({
        emoji,
        name,
      })),
    choose: chooser,
    react: (message, emoji, signal) =>
      reactions.add(context(message, signal), message.messageId, emoji),
  })
}

export type AmbientReactions = NonNullable<ReturnType<typeof discordAmbientReactions>>
