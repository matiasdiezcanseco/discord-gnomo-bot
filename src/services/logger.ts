import pino from 'pino'
import { ENV } from '../config/env.ts'

const isDev = ENV.NODE_ENV !== 'production'

export const logger = pino({
  level: ENV.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    service: 'discord-gnomo-bot',
  },
})

// Create child loggers for different modules
export const createLogger = (module: string) => logger.child({ module })
