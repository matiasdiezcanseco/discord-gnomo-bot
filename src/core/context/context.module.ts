import { Global, Module } from '@nestjs/common'
import { EnrichersModule } from '../enrichers/enrichers.module'

@Global()
@Module({
  imports: [EnrichersModule],
  exports: [EnrichersModule],
})
export class ContextModule {}
