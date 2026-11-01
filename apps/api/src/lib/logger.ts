import pino from 'pino';
import type { AppConfig } from '../config.ts';

/** Paths that must never reach logs (tokens, cookies, credentials, reply content). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.access_token',
  '*.refresh_token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.body',
  '*.minimalPermittedContext',
];

export function loggerOptions(cfg: AppConfig): pino.LoggerOptions {
  return {
    level: cfg.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(cfg.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  };
}

export function createLogger(cfg: AppConfig) {
  return pino(loggerOptions(cfg));
}
export type Logger = pino.Logger;
