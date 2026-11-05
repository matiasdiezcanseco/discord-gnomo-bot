import { z } from 'zod'
import type { ExecutionContext } from './catalog'
export const memberSchema = z.strictObject({
  id: z.string(),
  username: z.string(),
  displayName: z.string().nullable(),
  nickname: z.string().nullable(),
})
export const memberPageSchema = z.strictObject({
  members: z.array(memberSchema),
  coverage: z.enum(['complete', 'partial', 'unknown']),
  fromAfter: z.string().nullable(),
  nextAfter: z.string().nullable(),
  source: z.literal('discord-rest'),
  queriedAt: z.string(),
})
export type MemberPage = z.infer<typeof memberPageSchema>
export const memberDetailSchema = z.strictObject({
  member: memberSchema.nullable(),
  coverage: z.enum(['complete', 'unknown']),
  source: z.literal('discord-rest'),
  queriedAt: z.string(),
})
export interface MemberDirectory {
  list(context: ExecutionContext, limit: number, after?: string): Promise<MemberPage>
  detail(context: ExecutionContext, id: string): Promise<z.infer<typeof memberDetailSchema>>
}
