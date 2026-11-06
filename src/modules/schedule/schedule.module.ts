import { Module } from '@nestjs/common';
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule';
import { BirthdayCheckTask } from './birthday-check.task';
import { ReminderCheckTask } from './reminder-check.task';
import { DiscordModule } from '../discord/discord.module';
import { BucketModule } from '../services/bucket/bucket.module';
import { ReminderModule } from '../services/reminder/reminder.module';
import { LoggerModule } from '../services/logger/logger.module';
import { ConfigModule } from '../config/config.module';
import { ReliableNoticesTask } from './reliable-notices.task';

@Module({
  imports: [
    NestScheduleModule.forRoot(),
    DiscordModule,
    BucketModule,
    ReminderModule,
    LoggerModule,
    ConfigModule,
  ],
  providers: [BirthdayCheckTask, ReminderCheckTask, ReliableNoticesTask],
})
export class ScheduleModule {}
