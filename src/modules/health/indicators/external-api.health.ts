import { ConfigService } from '@nestjs/config'
import { Injectable } from '@nestjs/common'
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus'
import { HealthIndicator } from '@nestjs/terminus'
import { BucketService } from '../../services/bucket/bucket.service'

@Injectable()
export class ExternalApiHealthIndicator extends HealthIndicator {
  constructor(
    private readonly bucketService: BucketService,
    private readonly config: ConfigService,
  ) {
    super()
  }

  async isHealthy(key: string = 'external-api'): Promise<HealthIndicatorResult> {
    if (!this.config.get<string>('BUCKET_URL'))
      return this.getStatus(key, true, { configured: false })
    try {
      await this.bucketService.ping()
      return this.getStatus(key, true)
    } catch {
      throw new HealthCheckError('External API check failed', this.getStatus(key, false))
    }
  }
}
