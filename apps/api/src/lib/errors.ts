import type { ErrorCategory } from '@careerconnect/shared';

/** Error with an HTTP status and a stable machine code, rendered as { error: { code, message } }. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);

/** Error raised by an external provider (Reddit, LLM) with a retry classification. */
export class ProviderError extends Error {
  constructor(
    public readonly category: ErrorCategory,
    message: string,
    public readonly retryable: boolean,
    /** Server-provided delay before retrying, when available. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function classifyHttpStatus(status: number): { category: ErrorCategory; retryable: boolean } {
  if (status === 429) return { category: 'RATE_LIMITED', retryable: true };
  if (status === 401) return { category: 'AUTH', retryable: false };
  if (status === 403) return { category: 'FORBIDDEN', retryable: false };
  if (status === 404) return { category: 'NOT_FOUND', retryable: false };
  if (status === 400 || status === 422) return { category: 'VALIDATION', retryable: false };
  if (status >= 500) return { category: 'SERVER', retryable: true };
  return { category: 'UNKNOWN', retryable: false };
}

/** Parse Retry-After (seconds or HTTP date). */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
