import { searchCapabilities, type PublicSearch } from './public-search'
import { z } from 'zod'
import { Catalog, defineCapability } from './catalog'
import { memberCapabilities } from './member-capabilities'
import type { MemberDirectory } from './member-directory'
import { messagesHistory, type HistoryReader } from './channel-history'
import { collectionCapabilities, type CollectionSource } from './collection-content'
import { memoryCapabilities } from './explicit-memory'
import { webRead } from './web-read'
import { safeReader, type SafeReader } from '../web/safe-reader'
import { presenceCapability, voiceCapability, type LiveMembers } from './live-members'
import { reminderCapability } from './reminders'
import type { ScheduledNotices } from './scheduled-notices'
import { imageCapability, type ImageGenerator } from './image-generation'
import type { ImageQuota } from './image-quota'

/** Single composition point. Future capability modules export definitions, never edit the loop. */
export interface CapabilityDependencies {
  collection?: CollectionSource
  members?: MemberDirectory
  history?: HistoryReader
  search?: PublicSearch
  live?: Partial<LiveMembers>
  web?: SafeReader
  memory?: ReturnType<typeof memoryCapabilities>
  notices?: ScheduledNotices
  images?: { generator?: ImageGenerator; quota?: ImageQuota }
  extensions?: import('./catalog').Capability[]
}
export function composeCapabilities({
  collection,
  members,
  history,
  search,
  live,
  web = safeReader(),
  memory,
  notices,
  images,
  extensions = [],
}: CapabilityDependencies = {}) {
  return new Catalog([
    ...extensions,
    reminderCapability(notices),
    imageCapability(images?.generator, images?.quota),
    webRead(web),
    messagesHistory(history),
    ...collectionCapabilities(collection),
    ...searchCapabilities(search),
    ...(memory ?? memoryCapabilities()),
    ...(members ? memberCapabilities(members) : []),
    ...(live?.presence ? [presenceCapability(live.presence)] : []),
    ...(live?.voice ? [voiceCapability(live.voice)] : []),
    defineCapability({
      name: 'runtime_status',
      description: 'Comprueba la disponibilidad de la conversación autorizada.',
      capability: 'runtime.status',
      scope: 'channel',
      effect: 'read',
      input: z.strictObject({}),
      output: z.strictObject({ status: z.literal('ready'), messageId: z.string() }),
      maxCalls: 1,
      maxResultChars: 200,
      available: async () => true,
      execute: async (_, context) => ({
        status: 'ready' as const,
        messageId: context.invocation.messageId,
      }),
    }),
  ])
}
