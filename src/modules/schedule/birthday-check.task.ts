import { runtimeAllows } from '../../conversation/runtime-policy'
import { Inject, Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type Redis from 'ioredis'
import { DiscordService } from '../discord/discord.service'
import { BucketService } from '../services/bucket/bucket.service'
import { LoggerService } from '../services/logger/logger.service'
import { ConfigService } from '@nestjs/config'
import { scheduleBirthdays } from '../../conversation/birthdays'
import { ScheduledNotices } from '../../conversation/scheduled-notices'

/** Sole producer for the configured group, including outside the conversation pilot. */
@Injectable()
export class BirthdayCheckTask {
  constructor(
    private readonly discord: DiscordService,
    private readonly bucket: BucketService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    @Inject('REDIS_CONNECTION') private readonly redis: Redis | null,
  ) {}

  @Cron('0 * * * * *', { name: 'birthday-check', timeZone: 'America/Lima' })
  async handleBirthdayCheck(now = Date.now()) {
    if (!runtimeAllows(this.config, { guildId: this.config.get<string>('GUILD_ID', ''), channelId: this.config.get<string>('GNOMOS_CHANNEL_ID', '') }) || !this.config.get<string>('BUCKET_URL')) return
    if (!this.redis || !this.discord.isReady()) return
    try {
      await scheduleBirthdays(
        now,
        {
          guildId: this.config.get<string>('GUILD_ID'),
          channelId: this.config.get<string>('GNOMOS_CHANNEL_ID'),
        },
        () => this.bucket.fetchBucketData<unknown>('birthdays.json'),
        new ScheduledNotices(this.redis),
      )
    } catch {
      this.logger.error('Birthday scheduling failed; safe to retry', 'birthday-check')
    }
  }
}
