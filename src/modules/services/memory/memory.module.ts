import { Module, Global } from '@nestjs/common'
import { DatabaseModule } from '../../database/database.module'
import { MemoryService } from './memory.service'

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
