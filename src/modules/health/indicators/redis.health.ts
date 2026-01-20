import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import { HealthIndicator } from '@nestjs/terminus';
import { RedisHistoryService } from '../../services/redis/redis-history.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(
    private readonly redisHistoryService: RedisHistoryService,
  ) {
    super();
  }

  async isHealthy(key: string = 'redis'): Promise<HealthIndicatorResult> {
    try {
      await this.redisHistoryService.ping();
      return this.getStatus(key, true);
    } catch {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false),
      );
    }
  }
}
