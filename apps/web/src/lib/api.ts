import { API_PREFIX, CSRF_HEADER, type ApiError } from '@careerconnect/shared';

/** Typed error for every non-2xx response (or network failure, status 0). */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Do not trigger the global 401 handler (used by login / session probe). */
  skipAuthRedirect?: boolean;
}

let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/** Registered by the session provider: called on any 401 so the app can redirect to /login. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/** Builds "?a=1&b=x", dropping undefined / null / empty-string values. */
export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function withQuery(path: string, query?: Query): string {
  return `${path}${buildQuery(query)}`;
}

function isApiErrorBody(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const err = (value as { error: unknown }).error;
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { message?: unknown }).message === 'string' &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

function defaultMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return 'Insufficient role for this action.';
    case 404:
      return 'Not found.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    default:
      return status >= 500 ? 'The server encountered an error.' : `Request failed (HTTP ${status}).`;
  }
}

/**
 * Low-level request. `path` is relative to /api (e.g. "/drafts/123").
 * - JSON in / JSON out
 * - sends the CSRF header on every mutating request
 * - maps error bodies to ApiClientError
 */
export async function apiRequest<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }
  if (method !== 'GET' && csrfToken) headers.set(CSRF_HEADER, csrfToken);

  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}${buildQuery(options.query)}`, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiClientError(0, 'NETWORK_ERROR', 'Could not reach the API. Check your connection and try again.');
  }

  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!res.ok) {
    const error = isApiErrorBody(json)
      ? new ApiClientError(res.status, json.error.code, json.error.message, json.error.details)
      : new ApiClientError(res.status, `HTTP_${res.status}`, defaultMessage(res.status));
    if (res.status === 401 && !options.skipAuthRedirect) unauthorizedHandler?.();
    throw error;
  }

  return json as T;
}

export function toApiClientError(err: unknown): ApiClientError {
  if (err instanceof ApiClientError) return err;
  if (err instanceof Error) return new ApiClientError(0, 'CLIENT_ERROR', err.message);
  return new ApiClientError(0, 'CLIENT_ERROR', 'Unexpected error.');
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => apiRequest<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body: unknown, options?: RequestOptions) => apiRequest<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body: unknown, options?: RequestOptions) => apiRequest<T>('PATCH', path, { ...options, body }),
};
