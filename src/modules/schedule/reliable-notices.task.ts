import { Inject, Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { ScheduledNotices } from '../../conversation/scheduled-notices'
import { Transport } from '../transport/transport'
import { LoggerService } from '../services/logger/logger.service'
import { BucketService } from '../services/bucket/bucket.service'
import { describeError } from '../../diagnostics'

@Injectable()
export class ReliableNoticesTask {
  constructor(
    @Inject('REDIS_CONNECTION') private readonly redis: Redis | null,
    private readonly transport: Transport,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly bucket: BucketService,
  ) {}
  @Cron('*/10 * * * * *', { name: 'reliable-notices' })
  async dispatch() {
    if (this.config.get<string>('RUNTIME_MODE', 'paused') === 'paused') return
    if (!this.redis || !this.transport.isReady()) return
    try {
      await new ScheduledNotices(this.redis).dispatch(
        Date.now(),
        this.transport.scheduledDelivery(() =>
          this.bucket.fetchBucketData<unknown>('birthdays.json'),
        ),
      )
    } catch (error) {
      this.logger
        .createLogger('scheduled-notices')
        .error(
          { error: describeError(error) },
          'Scheduled notice dispatch failed; records retained',
        )
    }
  }
}
