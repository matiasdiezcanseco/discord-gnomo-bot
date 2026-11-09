import type { BirthdaySource } from '../../conversation/birthdays'
import type { ScheduledDelivery } from '../../conversation/scheduled-notices'

/**
 * Where invocations arrive and where replies/notices go: Discord in production, the terminal in
 * the local console. Schedulers and health depend only on this; everything else is shared.
 */
export abstract class Transport {
  abstract readonly name: string
  abstract isReady(): boolean
  abstract scheduledDelivery(source: BirthdaySource): ScheduledDelivery
}
