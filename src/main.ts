import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { AppModule } from './app.module'
import { LoggerService } from './modules/services/logger/logger.service'
import { runtimeSummary } from './modules/config/runtime-summary'
import { describeError } from './diagnostics'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  })

  // Use custom logger service
  const logger = app.get(LoggerService)
  app.useLogger(logger)
  const process_ = logger.createLogger('process')
  // Last resort: anything escaping a handler is logged with its cause before Node decides.
  process.on('unhandledRejection', (reason) =>
    process_.error({ error: describeError(reason) }, 'Unhandled promise rejection'),
  )
  process.on('uncaughtException', (error) => {
    process_.fatal({ error: describeError(error) }, 'Uncaught exception; exiting')
    process.exit(1)
  })
  logger
    .createLogger('startup')
    .info(runtimeSummary(app.get(ConfigService)), 'Runtime configuration')

  app.enableShutdownHooks()

  const port = process.env.PORT || 3000
  await app.listen(port)

  logger.log(`Application is running on: http://localhost:${port}`)
}
bootstrap().catch((error) => {
  // Startup failures (migrations, Redis, config validation) with a redacted cause.
  console.error(JSON.stringify({ level: 60, msg: 'Startup failed', error: describeError(error) }))
  process.exit(1)
})
