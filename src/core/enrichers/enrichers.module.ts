import { Module } from '@nestjs/common'
import { MemoryEnricher } from './memory-enricher'
import { ENRICHERS } from '../context/context-enricher'
import { MemoryModule } from '../../modules/services/memory/memory.module'
import { ConfigModule } from '../../modules/config/config.module'

@Module({
  imports: [MemoryModule, ConfigModule],
  providers: [
    MemoryEnricher,
    {
      provide: ENRICHERS,
      useFactory: (memoryEnricher: MemoryEnricher) => [memoryEnricher],
      inject: [MemoryEnricher],
    },
  ],
  exports: [ENRICHERS],
})
export class EnrichersModule {}
