import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

export const DATABASE_TOKEN = 'DATABASE'

export type Db = PrismaClient

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_TOKEN,
      useFactory: async (config: ConfigService) => {
        const connectionString = config.get<string>('DATABASE_URL')

        if (!connectionString) {
          return null
        }

        const adapter = new PrismaPg({ connectionString })
        const prisma = new PrismaClient({ adapter })

        try {
          await prisma.$connect()
        } catch {
          return null
        }

        return prisma
      },
      inject: [ConfigService],
    },
  ],
  exports: [DATABASE_TOKEN],
})
export class DatabaseModule {}
