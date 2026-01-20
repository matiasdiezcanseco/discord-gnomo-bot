import { Injectable, LoggerService as NestLoggerService, Scope } from '@nestjs/common';
import { Logger as PinoLogger } from 'pino';

@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService implements NestLoggerService {
  constructor(private readonly logger: PinoLogger) {}

  /**
   * Log a message at the error level
   */
  error(message: unknown, context?: string, trace?: string): void {
    this.logger.error({ context, trace }, message as string);
  }

  /**
   * Log a message at the warn level
   */
  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, message as string);
  }

  /**
   * Log a message at the log/info level
   */
  log(message: unknown, context?: string): void {
    this.logger.info({ context }, message as string);
  }

  /**
   * Log a message at the info level
   */
  info(message: unknown, context?: string): void {
    this.logger.info({ context }, message as string);
  }

  /**
   * Log a message at the debug level
   */
  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, message as string);
  }

  /**
   * Log a message at the verbose level
   */
  verbose?(message: unknown, context?: string): void {
    this.logger.trace({ context }, message as string);
  }

  /**
   * Create a child logger with a specific context
   */
  createLogger(module: string): PinoLogger {
    return this.logger.child({ module });
  }
}
