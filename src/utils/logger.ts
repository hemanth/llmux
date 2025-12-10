import pino from 'pino';
import type { LoggingConfig } from '../types.js';

let logger: pino.Logger;

export function createLogger(config: LoggingConfig): pino.Logger {
  logger = pino({
    level: config.level,
    transport: config.pretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  });

  return logger;
}

export function getLogger(): pino.Logger {
  if (!logger) {
    // Create a default logger if not initialized
    logger = pino({ level: 'info' });
  }
  return logger;
}
