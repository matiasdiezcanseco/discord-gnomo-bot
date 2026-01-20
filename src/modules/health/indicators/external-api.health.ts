import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import { HealthIndicator } from '@nestjs/terminus';
import { BucketService } from '../../services/bucket/bucket.service';

@Injectable()
export class ExternalApiHealthIndicator extends HealthIndicator {
  constructor(
    private readonly bucketService: BucketService,
  ) {
    super();
  }

  async isHealthy(key: string = 'external-api'): Promise<HealthIndicatorResult> {
    try {
      await this.bucketService.ping();
      return this.getStatus(key, true);
    } catch {
      throw new HealthCheckError(
        'External API check failed',
        this.getStatus(key, false),
      );
    }
  }
}
