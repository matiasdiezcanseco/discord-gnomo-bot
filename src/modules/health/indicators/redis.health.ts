import { Inject, Injectable } from '@nestjs/common'
import { HealthIndicator } from '@nestjs/terminus'
import type Redis from 'ioredis'
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject('REDIS_CONNECTION') private readonly redis: Redis | null) {
    super()
  }
  async isHealthy(key = 'redis') {
    if (!this.redis)
      return this.getStatus(key, true, { configured: false, admission: 'unavailable' })
    try {
      await this.redis.ping()
      return this.getStatus(key, true, { configured: true })
    } catch {
      return this.getStatus(key, false)
    }
  }
}
