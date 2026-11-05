import { searchCapabilities, type PublicSearch } from './public-search'
import { z } from 'zod'
import { Catalog, defineCapability } from './catalog'
import { collectionCapabilities, type CollectionSource } from './collection-content'

/** Single composition point. Future capability modules export definitions, never edit the loop. */
export function pilotCatalog(collection?: CollectionSource, search?: PublicSearch) {
  return new Catalog([
    ...collectionCapabilities(collection),
    ...searchCapabilities(search),
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
