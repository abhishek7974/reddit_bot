import { CSRF_HEADER } from '@careerconnect/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api, buildQuery, setCsrfToken, setUnauthorizedHandler } from '../api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('tok-123');
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    setCsrfToken(null);
    setUnauthorizedHandler(null);
  });

  it('sends the CSRF header and JSON body on mutating requests', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await api.post('/drafts/d1/approve', { note: 'lgtm' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/drafts/d1/approve');
    const headers = new Headers(init?.headers);
    expect(headers.get(CSRF_HEADER)).toBe('tok-123');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ note: 'lgtm' }));
    expect(init?.credentials).toBe('same-origin');
  });

  it('does not send CSRF header or content-type on GET / bodiless POST', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    await api.get('/policies');
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get(CSRF_HEADER)).toBeNull();

    fetchMock.mockResolvedValue(jsonResponse(200, { purged: true }));
    await api.post('/conversations/c1/purge');
    const headers = new Headers(fetchMock.mock.calls[1]![1]?.headers);
    expect(headers.get(CSRF_HEADER)).toBe('tok-123');
    expect(headers.get('Content-Type')).toBeNull();
    expect(fetchMock.mock.calls[1]![1]?.body).toBeUndefined();
  });

  it('passes custom headers such as Idempotency-Key', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { queued: false }));
    await api.post('/drafts/d1/publish', undefined, { headers: { 'Idempotency-Key': 'abc' } });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('Idempotency-Key')).toBe('abc');
  });

  it('maps API error bodies to ApiClientError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'Requires ADMIN', details: { need: 'ADMIN' } } }));
    const err = await api.post('/admin/publishing/pause', { reason: 'test' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    const e = err as ApiClientError;
    expect(e.status).toBe(403);
    expect(e.isForbidden).toBe(true);
    expect(e.code).toBe('FORBIDDEN');
    expect(e.message).toBe('Requires ADMIN');
    expect(e.details).toEqual({ need: 'ADMIN' });
  });

  it('handles non-JSON error responses', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    const err = (await api.get('/dashboard/summary').catch((e: unknown) => e)) as ApiClientError;
    expect(err.status).toBe(502);
    expect(err.code).toBe('HTTP_502');
  });

  it('maps network failures to status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await api.get('/dashboard/summary').catch((e: unknown) => e)) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('NETWORK_ERROR');
  });

  it('calls the unauthorized handler on 401 unless skipped', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockImplementation(async () => jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Login required' } }));

    await expect(api.get('/drafts')).rejects.toBeInstanceOf(ApiClientError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    await expect(api.get('/auth/me', { skipAuthRedirect: true })).rejects.toBeInstanceOf(ApiClientError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('buildQuery drops empty values', () => {
    expect(buildQuery({ page: 2, topic: '', search: undefined, community: 'cscareerquestions', x: null })).toBe('?page=2&community=cscareerquestions');
    expect(buildQuery({})).toBe('');
  });
});
