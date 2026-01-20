import { Module, Provider, DynamicModule, Type, InjectionToken, OptionalFactoryDependency, ForwardReference } from '@nestjs/common';
import pino from 'pino';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from './logger.service';

/**
 * Logger module configuration
 */
interface LoggerModuleAsyncOptions {
  imports?: (Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference<unknown>)[];
  useFactory: (...args: unknown[]) => pino.LoggerOptions;
  inject?: (InjectionToken | OptionalFactoryDependency)[];
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
          const isDev = config.get<string>('NODE_ENV') !== 'production';
          const options = isDev
            ? {
                ...pinoOptions,
                transport: {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                  },
                },
              }
            : pinoOptions;

          const logger = pino({
            level: config.get<string>('LOG_LEVEL') || (isDev ? 'debug' : 'info'),
            base: {
              service: 'discord-gnomo-bot',
            },
            ...options,
          });

          return new LoggerService(logger);
        },
        inject: ['PINO_OPTIONS', ConfigService],
      },
    ];

    return {
      module: LoggerModule,
      imports: options.imports || [],
      providers: asyncProviders,
      exports: [LoggerService],
      global: true,
    };
  }
}
