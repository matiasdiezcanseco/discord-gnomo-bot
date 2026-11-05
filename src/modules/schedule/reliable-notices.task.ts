import { Inject, Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { ScheduledNotices } from '../../conversation/scheduled-notices'
import { discordScheduledDelivery } from '../discord/scheduled-delivery'
import { DiscordService } from '../discord/discord.service'
import { LoggerService } from '../services/logger/logger.service'

@Injectable()
export class ReliableNoticesTask {
  constructor(
    @Inject('REDIS_CONNECTION') private readonly redis: Redis | null,
    private readonly discord: DiscordService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}
  @Cron('*/10 * * * * *', { name: 'reliable-notices' })
  async dispatch() {
    if (!this.redis || !this.discord.isReady()) return
    try {
      await new ScheduledNotices(this.redis).dispatch(
        Date.now(),
        discordScheduledDelivery(this.discord.getClient(), this.config),
      )
    } catch {
      this.logger.error('Scheduled notice dispatch failed; records retained', 'scheduled-notices')
    }
  }
}
