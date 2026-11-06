import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { LoggerService } from './modules/services/logger/logger.service'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  })

  // Use custom logger service
  const logger = app.get(LoggerService)
  app.useLogger(logger)

  app.enableShutdownHooks()

  const port = process.env.PORT || 3000
  await app.listen(port)

  logger.log(`Application is running on: http://localhost:${port}`)
}
bootstrap()
