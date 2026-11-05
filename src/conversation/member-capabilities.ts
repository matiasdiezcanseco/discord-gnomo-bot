import { z } from 'zod'
import { defineCapability, partialResult } from './catalog'
import { memberPageSchema, memberDetailSchema, type MemberDirectory } from './member-directory'

export function memberCapabilities(directory: MemberDirectory) {
  return [
    defineCapability({
      name: 'members_detail',
      description: 'Consulta pertenencia actual e identidad por ID, sin depender de caché.',
      capability: 'discord.members',
      scope: 'channel',
      effect: 'read',
      input: z.strictObject({ id: z.string().regex(/^\d+$/) }),
      output: memberDetailSchema,
      maxCalls: 3,
      maxResultChars: 2000,
      available: async () => true,
      execute: async ({ id }, context) => {
        const result = await directory.detail(context, id)
        return result.coverage === 'complete' ? result : partialResult(result)
      },
    }),
    defineCapability({
      name: 'members_search',
      description:
        'Busca nombre o apodo en páginas de miembros. Continúa con nextAfter hasta completar; IDs distinguen homónimos. No autoriza notificaciones.',
      capability: 'discord.members',
      scope: 'channel',
      effect: 'read',
      input: z.strictObject({
        query: z.string().trim().min(1).max(100),
        limit: z.number().int().min(1).max(100).default(100),
        after: z.string().regex(/^\d+$/).optional(),
      }),
      output: memberPageSchema,
      maxCalls: 3,
      maxResultChars: 16000,
      available: async () => true,
      execute: async ({ query, limit, after }, context) => {
        const result = await directory.list(context, limit, after)
        result.members = result.members.filter((member) =>
          [member.username, member.nickname, member.displayName].some((name) =>
            name?.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          ),
        )
        return result.coverage === 'complete' ? result : partialResult(result)
      },
    }),
    defineCapability({
      name: 'members_list',
      description:
        'Lista una página de miembros actuales. Sigue nextAfter; cobertura parcial no es un censo completo.',
      capability: 'discord.members',
      scope: 'channel',
      effect: 'read',
      input: z.strictObject({
        limit: z.number().int().min(1).max(100).default(25),
        after: z.string().regex(/^\d+$/).optional(),
      }),
      output: memberPageSchema,
      maxCalls: 3,
      maxResultChars: 16000,
      available: async () => true,
      execute: async ({ limit, after }, context) => {
        const result = await directory.list(context, limit, after)
        return result.coverage === 'complete' ? result : partialResult(result)
      },
    }),
  ]
}
