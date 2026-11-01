'use client';

import { loginBody, type SessionResponse } from '@careerconnect/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, TextField } from '@/components/ui';
import { api, setCsrfToken, toApiClientError } from '@/lib/api';
import { safeNextPath } from '@/lib/redirect';
import { fieldErrors } from '@/lib/validation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Already signed in? Skip the form.
  useEffect(() => {
    api.get<SessionResponse>('/auth/me', { skipAuthRedirect: true }).then(
      (res) => {
        setCsrfToken(res.csrfToken);
        router.replace(safeNextPath(new URLSearchParams(window.location.search).get('next')));
      },
      () => undefined,
    );
  }, [router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = loginBody.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const res = await api.post<SessionResponse>('/auth/login', parsed.data, { skipAuthRedirect: true });
      setCsrfToken(res.csrfToken);
      router.replace(safeNextPath(new URLSearchParams(window.location.search).get('next')));
    } catch (err) {
      const apiErr = toApiClientError(err);
      setFormError(apiErr.status === 401 ? 'Invalid email or password.' : apiErr.message);
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Sign in to CareerConnect AI</h1>
        <p className="mt-1 text-sm text-slate-600">Draft-first, policy-gated replies to career discussions.</p>
        <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            error={errors.email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            error={errors.password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div role="alert" aria-live="assertive">
            {formError ? <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950">{formError}</p> : null}
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
