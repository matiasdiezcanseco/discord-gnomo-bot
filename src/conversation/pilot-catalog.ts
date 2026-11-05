import { searchCapabilities, type PublicSearch } from './public-search'
import { z } from 'zod'
import { Catalog, defineCapability } from './catalog'
import { memberCapabilities } from './member-capabilities'
import type { MemberDirectory } from './member-directory'
import { messagesHistory, type HistoryReader } from './channel-history'
import { collectionCapabilities, type CollectionSource } from './collection-content'
import { webRead } from './web-read'
import { safeReader, type SafeReader } from '../web/safe-reader'
import { presenceCapability, voiceCapability, type LiveMembers } from './live-members'

/** Single composition point. Future capability modules export definitions, never edit the loop. */
export function pilotCatalog(
  collection?: CollectionSource,
  members?: MemberDirectory,
  history?: HistoryReader,
  search?: PublicSearch,
  live?: Partial<LiveMembers>,
  web: SafeReader = safeReader(),
) {
  return new Catalog([
    webRead(web),
    messagesHistory(history),
    ...collectionCapabilities(collection),
    ...searchCapabilities(search),
    ...(members ? memberCapabilities(members) : []),
    ...(live?.presence ? [presenceCapability(live.presence)] : []),
    ...(live?.voice ? [voiceCapability(live.voice)] : []),
    defineCapability({
      name: 'pilot_status',
      description: 'Comprueba que la conversación usa el harness autorizado del piloto.',
      capability: 'pilot.status',
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
