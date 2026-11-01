'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, apiRequest, toApiClientError } from './api';

export interface ApiQueryState<T> {
  data: T | undefined;
  error: ApiClientError | undefined;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
}

/** GET `path` (relative to /api). Pass null to skip. Refetches when the path changes. */
export function useApi<T>(path: string | null): ApiQueryState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiClientError | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    apiRequest<T>('GET', path, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        setDataState(result);
        setLoading(false);
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setError(toApiClientError(err));
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((value: T) => {
    setDataState(value);
    setError(undefined);
  }, []);

  return { data, error, loading, reload, setData };
}

export type ActionTone = 'success' | 'error' | 'info';
export interface ActionMessage {
  tone: ActionTone;
  text: string;
}

/** Runs a mutation, tracking pending state and a user-facing (aria-live) message. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);

  const run = useCallback(
    async <T>(fn: () => Promise<T>, successText?: string | ((result: T) => string)): Promise<T | undefined> => {
      setPending(true);
      setMessage(null);
      try {
        const result = await fn();
        if (successText) {
          setMessage({ tone: 'success', text: typeof successText === 'function' ? successText(result) : successText });
        }
        return result;
      } catch (err) {
        const e = toApiClientError(err);
        setMessage({ tone: 'error', text: describeError(e) });
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { pending, message, setMessage, run };
}

export function describeError(e: ApiClientError): string {
  if (e.isForbidden) return `Insufficient role: ${e.message}`;
  if (e.status === 0) return e.message;
  return `${e.message} (${e.code})`;
}
