import type { Invocation } from '../core/conversation/invocation'
import type { Capability } from './catalog'

/** Shared tool allowlist; transports separately establish scope and current permissions. */
export function capabilityAllowed(invocation: Invocation, tool?: Capability): boolean {
  return (
    !tool ||
    // Intent is judged by the model; the effect is limited to the requester in this channel.
    (tool.capability === 'reminders.own' && tool.effect === 'write') ||
    // Bounded by a per-requester hourly quota enforced in Redis before any credit is spent.
    (tool.capability === 'images.generate' && tool.effect === 'write') ||
    // Same pattern: a per-requester cooldown in Redis, taken before any credit is spent.
    (tool.capability === 'speech.generate' && tool.effect === 'write') ||
    (tool.capability.startsWith('memory.') &&
      ((tool.capability === 'memory.search' && tool.effect === 'read') ||
        (['memory.save', 'memory.update', 'memory.forget'].includes(tool.capability) &&
          tool.effect === 'write'))) ||
    (['media.save', 'media.forget'].includes(tool.capability) && tool.effect === 'write') ||
    ([
      'runtime.status',
      'messages.history',
      'collection.phrase',
      'collection.photo',
      'discord.members',
      'web.read',
      'discord.presence',
      'discord.voice',
      'web.search',
      'web.news',
      'media.search',
      'media.share',
    ].includes(tool.capability) &&
      tool.effect === 'read')
  )
}
