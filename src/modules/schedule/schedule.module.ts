import { Module } from '@nestjs/common'
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule'
import { BirthdayCheckTask } from './birthday-check.task'
import { BucketModule } from '../services/bucket/bucket.module'
import { LoggerModule } from '../services/logger/logger.module'
import { ConfigModule } from '../config/config.module'
import { ReliableNoticesTask } from './reliable-notices.task'

@Module({
  imports: [NestScheduleModule.forRoot(), BucketModule, LoggerModule, ConfigModule],
  providers: [BirthdayCheckTask, ReliableNoticesTask],
})
export class ScheduleModule {}
