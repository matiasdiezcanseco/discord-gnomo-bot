import { Injectable } from '@nestjs/common'
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus'
import { HealthIndicator } from '@nestjs/terminus'
import { Transport } from '../../transport/transport'

@Injectable()
export class DiscordHealthIndicator extends HealthIndicator {
  constructor(private readonly transport: Transport) {
    super()
  }

  async isHealthy(key: string = this.transport.name): Promise<HealthIndicatorResult> {
    try {
      const isReady = this.transport.isReady()
      return this.getStatus(key, isReady)
    } catch {
      throw new HealthCheckError('Transport check failed', this.getStatus(key, false))
    }
  }
}
