import { Module } from '@nestjs/common';
import { ReminderService } from './reminder.service';
import { RedisModule } from '../redis/redis.module';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [RedisModule, LoggerModule],
  providers: [ReminderService],
  exports: [ReminderService],
})
export class ReminderModule {}
