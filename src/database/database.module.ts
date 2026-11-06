import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Pool } from 'pg'
import { ConfigModule } from '../modules/config/config.module'
import { databasePoolConfig, databaseVariables } from './configuration'
import { migrateMemoryDatabase } from './migrate'

const DATABASE_STARTUP = Symbol('DATABASE_STARTUP')

/** Nest awaits async providers before any lifecycle hooks (Discord/schedulers) or listen. */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DATABASE_STARTUP,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const options = databasePoolConfig(
          Object.fromEntries(databaseVariables.map((key) => [key, config.get<string>(key)])),
          'migration',
        )
        // Chat can run without SQL memory; configured databases are always migrated, even paused.
        if (!options) return 'unconfigured'
        const pool = new Pool(options)
        pool.on('error', () => undefined)
        try {
          await migrateMemoryDatabase(pool)
          return 'ready'
        } catch {
          // SQL errors may contain row data/credentials. Fail closed with a safe message.
          throw new Error(
            'Startup migrations failed; application startup aborted. Check the direct DATABASE_URL and committed database schema.',
          )
        } finally {
          await pool.end()
        }
      },
    },
  ],
})
export class DatabaseModule {}
