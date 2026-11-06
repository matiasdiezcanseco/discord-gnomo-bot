import { Inject, Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { ScheduledNotices } from '../../conversation/scheduled-notices'
import { discordScheduledDelivery } from '../discord/scheduled-delivery'
import { DiscordService } from '../discord/discord.service'
import { LoggerService } from '../services/logger/logger.service'
import { BucketService } from '../services/bucket/bucket.service'

@Injectable()
export class ReliableNoticesTask {
  constructor(
    @Inject('REDIS_CONNECTION') private readonly redis: Redis | null,
    private readonly discord: DiscordService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly bucket: BucketService,
  ) {}
  @Cron('*/10 * * * * *', { name: 'reliable-notices' })
  async dispatch() {
    if (this.config.get<string>('RUNTIME_MODE', 'paused') === 'paused') return
    if (!this.redis || !this.discord.isReady()) return
    try {
      await new ScheduledNotices(this.redis).dispatch(
        Date.now(),
        discordScheduledDelivery(this.discord.getClient(), this.config, () =>
          this.bucket.fetchBucketData<unknown>('birthdays.json'),
        ),
      )
    } catch {
      this.logger.error('Scheduled notice dispatch failed; records retained', 'scheduled-notices')
    }
  }
}
