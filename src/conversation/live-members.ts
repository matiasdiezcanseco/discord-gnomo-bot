import { z } from 'zod'
import { defineCapability, partialResult, type ExecutionContext } from './catalog'
import { memberSchema } from './member-directory'

const pageInput = z.strictObject({
  limit: z.number().int().min(1).max(50).default(25),
  after: z.string().regex(/^\d+$/).optional(),
})
const metadata = {
  coverage: z.enum(['partial', 'unknown']),
  memberCoverage: z.enum(['complete', 'partial', 'unknown']),
  fromAfter: z.string().nullable(),
  nextAfter: z.string().nullable(),
  queriedAt: z.string(),
  source: z.literal('discord-gateway'),
  note: z.string(),
}
export const presencePage = z.strictObject({
  ...metadata,
  members: z.array(
    memberSchema.extend({
      status: z.enum(['online', 'idle', 'dnd', 'offline', 'unknown']),
      connected: z.boolean().nullable(),
      label: z.string(),
    }),
  ),
})
export const voicePage = z.strictObject({
  ...metadata,
  participants: z.array(
    memberSchema.extend({
      channel: z.strictObject({ id: z.string(), name: z.string() }),
    }),
  ),
})
type Reader<T> = (context: ExecutionContext, limit: number, after?: string) => Promise<T>
export interface LiveMembers {
  presence: Reader<z.infer<typeof presencePage>>
  voice: Reader<z.infer<typeof voicePage>>
}
export function presenceCapability(read: LiveMembers['presence']) {
  return defineCapability({
    name: 'presence_list',
    description:
      'Consulta una página de presencias visibles: online/idle/dnd conectados, offline aparece desconectado. Invisible no se detecta. Ausencia es desconocida; comunica queriedAt y cobertura. Nunca inferir de mensajes ni voz.',
    capability: 'discord.presence',
    scope: 'channel',
    effect: 'read',
    input: pageInput,
    output: presencePage,
    maxCalls: 2,
    maxResultChars: 16000,
    available: async () => true,
    execute: async ({ limit, after }, context) => partialResult(await read(context, limit, after)),
  })
}
export function voiceCapability(read: LiveMembers['voice']) {
  return defineCapability({
    name: 'voice_list',
    description:
      'Consulta participantes en voz de una página de miembros, solo canales visibles al solicitante y bot. Sigue nextAfter; comunica queriedAt y cobertura parcial. No indica presencia ni confirma ausencia de llamada.',
    capability: 'discord.voice',
    scope: 'channel',
    effect: 'read',
    input: pageInput,
    output: voicePage,
    maxCalls: 2,
    maxResultChars: 16000,
    available: async () => true,
    execute: async ({ limit, after }, context) => partialResult(await read(context, limit, after)),
  })
}
