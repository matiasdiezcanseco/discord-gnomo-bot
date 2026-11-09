import {
  Module,
  Provider,
  DynamicModule,
  Type,
  InjectionToken,
  OptionalFactoryDependency,
  ForwardReference,
} from '@nestjs/common'
import pino from 'pino'
import { ConfigService } from '@nestjs/config'
import { LoggerService } from './logger.service'
import { setDiagnosticsSink } from '../../../diagnostics'

/**
 * Logger module configuration
 */
interface LoggerModuleAsyncOptions {
  imports?: (Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference<unknown>)[]
  useFactory: (...args: unknown[]) => pino.LoggerOptions
  inject?: (InjectionToken | OptionalFactoryDependency)[]
}

/**
 * Log file for the console transport (SANDBOX_LOG_FILE, default sandbox.log; `stdout` keeps logs
 * in the terminal). Discord always logs to stdout.
 */
export function logFile(config: Pick<ConfigService, 'get'>): string | undefined {
  if (config.get<string>('GNOMO_TRANSPORT') !== 'console') return undefined
  const file = config.get<string>('SANDBOX_LOG_FILE')?.trim() || 'sandbox.log'
  return file === 'stdout' ? undefined : file
}

/**
 * Dynamic module for logger configuration
 */
@Module({})
export class LoggerModule {
  static registerAsync(options: LoggerModuleAsyncOptions): DynamicModule {
    const asyncProviders: Provider[] = [
      {
        provide: 'PINO_OPTIONS',
        useFactory: options.useFactory,
        inject: options.inject || [],
      },
      {
        provide: LoggerService,
        useFactory: (pinoOptions: pino.LoggerOptions, config: ConfigService) => {
          const isDev = config.get<string>('NODE_ENV') !== 'production'
          // The console sandbox owns the terminal for chat; its logs go to a file instead.
          const file = logFile(config)
          const options = isDev
            ? {
                ...pinoOptions,
                transport: {
                  target: 'pino-pretty',
                  options: {
                    colorize: !file,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                    ...(file ? { destination: file, mkdir: true } : {}),
                  },
                },
              }
            : pinoOptions

          const logger = pino(
            {
              level: config.get<string>('LOG_LEVEL') || (isDev ? 'debug' : 'info'),
              base: {
                service: 'discord-gnomo-bot',
              },
              ...options,
            },
            !isDev && file ? pino.destination({ dest: file, mkdir: true }) : undefined,
          )

          // Errors the runtime handles on purpose still reach the logs with their cause.
          const diagnostics = logger.child({ module: 'diagnostics' })
          setDiagnosticsSink((scope, error, context) =>
            diagnostics.warn({ scope, error, ...context }, `handled error in ${scope}`),
          )
          // AI SDK warnings use console.warn by default; keep them structured, with the rest.
          const ai = logger.child({ module: 'ai-sdk' })
          globalThis.AI_SDK_LOG_WARNINGS = ({ warnings, provider, model }) =>
            ai.warn({ warnings, provider, model }, 'AI SDK warning')

          return new LoggerService(logger)
        },
        inject: ['PINO_OPTIONS', ConfigService],
      },
    ]

    return {
      module: LoggerModule,
      imports: options.imports || [],
      providers: asyncProviders,
      exports: [LoggerService],
      global: true,
    }
  }
}
