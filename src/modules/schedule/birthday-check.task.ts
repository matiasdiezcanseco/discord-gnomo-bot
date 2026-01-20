import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import dayjs from 'dayjs';
import { userMention, type TextChannel } from 'discord.js';
import { DiscordService } from '../discord/discord.service';
import { BucketService } from '../services/bucket/bucket.service';
import { LoggerService } from '../services/logger/logger.service';
import { ConfigService } from '@nestjs/config';

interface Birthday {
  id: string;
  name: string;
  date: string;
}

/**
 * Task to check for birthdays and send greetings
 * Runs daily at 8 AM
 */
@Injectable()
export class BirthdayCheckTask {
  private readonly logger;

  constructor(
    private readonly discord: DiscordService,
    private readonly bucket: BucketService,
    private readonly config: ConfigService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.createLogger('birthday-check');
  }

  @Cron('0 8 * * *', { name: 'birthday-check' })
  async handleBirthdayCheck() {
    const birthdays = await this.bucket.fetchBucketData<Birthday[]>('birthdays.json');
    if (!birthdays) return;

    const today = dayjs().format('MM-DD');
    const channelId = this.config.get<string>('GNOMOS_CHANNEL_ID');

    if (!channelId) {
      this.logger.warn('GNOMOS_CHANNEL_ID not configured');
      return;
    }

    const channel = this.discord.getChannel(channelId);
    if (!channel || channel.type !== 0) return; // 0 is GuildText

    const textChannel = channel as TextChannel;

    for (const birthday of birthdays) {
      if (birthday.date === today) {
        const message = `${userMention(birthday.id)} Feliz cumpleaños ${birthday.name}! 🎉🎉🎉`;
        this.logger.info({ name: birthday.name, userId: birthday.id }, 'Sending birthday message');
        await textChannel.send(message);
      }
    }
  }
}
