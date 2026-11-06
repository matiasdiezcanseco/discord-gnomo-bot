import type { Invocation } from '../core/conversation/invocation'
import type { Capability } from './catalog'

/** Shared tool allowlist; transports separately establish scope and current permissions. */
export function capabilityAllowed(invocation: Invocation, tool?: Capability): boolean {
  return (
    !tool ||
    (tool.capability === 'reminders.own' &&
      tool.effect === 'write' &&
      /^(?:por favor,?\s+)?(?:recu[eé]rdame|recordarme)\s+/i.test(invocation.content.trim())) ||
    (tool.capability.startsWith('memory.') &&
      ((tool.capability === 'memory.search' && tool.effect === 'read') ||
        (['memory.save', 'memory.update', 'memory.forget'].includes(tool.capability) &&
          tool.effect === 'write'))) ||
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
    ].includes(tool.capability) &&
      tool.effect === 'read')
  )
}
