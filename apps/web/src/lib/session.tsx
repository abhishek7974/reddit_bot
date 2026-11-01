'use client';

import type { PublishingStateDto, Role, SessionResponse, SessionUser } from '@careerconnect/shared';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrfToken, setUnauthorizedHandler, toApiClientError, type ApiClientError } from './api';
import { roleAtLeast } from './roles';

interface SessionContextValue {
  user: SessionUser;
  hasRole: (min: Role) => boolean;
  logout: () => Promise<void>;
  publishing: PublishingStateDto | null;
  setPublishing: (state: PublishingStateDto) => void;
  refreshPublishing: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function loginRedirectPath(pathname: string | null): string {
  if (!pathname || pathname === '/' || pathname.startsWith('/login')) return '/login';
  return `/login?next=${encodeURIComponent(pathname)}`;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [publishing, setPublishing] = useState<PublishingStateDto | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Any 401 anywhere in the app -> back to /login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCsrfToken(null);
      router.replace(loginRedirectPath(window.location.pathname));
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.get<SessionResponse>('/auth/me', { skipAuthRedirect: true }).then(
      (res) => {
        if (cancelled) return;
        setCsrfToken(res.csrfToken);
        setSession(res);
      },
      (err: unknown) => {
        if (cancelled) return;
        const e = toApiClientError(err);
        if (e.isUnauthorized) router.replace(loginRedirectPath(pathname));
        else setError(e);
      },
    );
    return () => {
      cancelled = true;
    };
    // Only probe the session once per mount / retry, not on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const refreshPublishing = useCallback(() => {
    api.get<PublishingStateDto>('/admin/publishing').then(setPublishing, () => {
      /* banner simply stays as-is; the System page shows errors */
    });
  }, []);

  useEffect(() => {
    if (session) refreshPublishing();
  }, [session, refreshPublishing]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', undefined, { skipAuthRedirect: true });
    } catch {
      // Session may already be gone; proceed to login either way.
    }
    setCsrfToken(null);
    setSession(null);
    router.replace('/login');
  }, [router]);

  const value = useMemo<SessionContextValue | null>(() => {
    if (!session) return null;
    return {
      user: session.user,
      hasRole: (min: Role) => roleAtLeast(session.user.role, min),
      logout,
      publishing,
      setPublishing,
      refreshPublishing,
    };
  }, [session, logout, publishing, refreshPublishing]);

  if (error) {
    return (
      <main className="mx-auto mt-24 max-w-md rounded-lg border border-red-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Unable to load your session</h1>
        <p className="mt-2 text-sm text-slate-700" role="alert">
          {error.message}
        </p>
        <button
          type="button"
          className="mt-4 rounded-md bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Retry
        </button>
      </main>
    );
  }

  if (!value) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <span className="text-sm text-slate-600">Checking your session…</span>
      </div>
    );
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
