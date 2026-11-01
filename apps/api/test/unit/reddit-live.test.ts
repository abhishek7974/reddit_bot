import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import { ProviderError, classifyHttpStatus, parseRetryAfter } from '../../src/lib/errors.ts';
import { createLogger } from '../../src/lib/logger.ts';
import { LiveRedditProvider } from '../../src/reddit/live.ts';
import { publishBackoff } from '../../src/worker.ts';

const cfg = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_MODE: 'LIVE',
  DATABASE_URL: 'postgresql://unused',
  REDDIT_CLIENT_ID: 'id',
  REDDIT_CLIENT_SECRET: 'secret',
  REDDIT_REFRESH_TOKEN: 'refresh',
  REDDIT_USER_AGENT: 'web:careerconnect-test:0.1.0 (by /u/test)',
} as NodeJS.ProcessEnv);
const log = createLogger(cfg);

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const tokenOk = () => json({ access_token: 'tok', expires_in: 3600 });

/** Sequence of responses (or thrown errors) returned by the fake fetch, in order. */
function fakeFetch(...steps: (Response | Error)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error('unexpected fetch');
    if (step instanceof Error) throw step;
    return step;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('LiveRedditProvider', () => {
  it('requires credentials', () => {
    expect(() => new LiveRedditProvider({ ...cfg, REDDIT_REFRESH_TOKEN: undefined }, log)).toThrow(/requires/);
  });

  it('reports OAuth failures as non-retryable AUTH errors', async () => {
    const { fn } = fakeFetch(json({ error: 'invalid_grant' }, 400));
    const p = new LiveRedditProvider(cfg, log, fn);
    await expect(p.listNewPosts('careeradvice', 5)).rejects.toMatchObject({ category: 'VALIDATION', retryable: false });

    const { fn: fn2 } = fakeFetch(json({}, 401));
    await expect(new LiveRedditProvider(cfg, log, fn2).listNewPosts('x', 5)).rejects.toMatchObject({ category: 'AUTH' });

    const { fn: fn3 } = fakeFetch(json({ error: 'invalid_grant' }));
    await expect(new LiveRedditProvider(cfg, log, fn3).listNewPosts('x', 5)).rejects.toMatchObject({ category: 'AUTH' });
  });

  it('sends the configured User-Agent and bearer token, and maps posts minimally', async () => {
    const listing = {
      data: {
        children: [
          {
            kind: 't3',
            data: {
              name: 't3_abc', subreddit: 'careeradvice', title: 'Q?', selftext: 'x'.repeat(5000), permalink: '/r/careeradvice/comments/abc/q/',
              created_utc: 1_790_000_000, locked: false, removed_by_category: null, author: 'someone',
            },
          },
        ],
      },
    };
    const { fn, calls } = fakeFetch(tokenOk(), json(listing, 200, { 'x-ratelimit-remaining': '99', 'x-ratelimit-reset': '60' }));
    const posts = await new LiveRedditProvider(cfg, log, fn).listNewPosts('careeradvice', 10);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.length).toBeLessThanOrEqual(1500);
    expect(posts[0]!.permalink).toBe('https://www.reddit.com/r/careeradvice/comments/abc/q/');
    const headers = calls[1]!.init!.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(cfg.REDDIT_USER_AGENT);
    expect(headers.Authorization).toBe('Bearer tok');
    expect(calls[1]!.url).toMatch(/^https:\/\/oauth\.reddit\.com\/r\/careeradvice\/new/);
  });

  it('retries transient read failures (network, 5xx) with a bound', async () => {
    vi.useFakeTimers();
    try {
      const { fn } = fakeFetch(tokenOk(), new TypeError('fetch failed'), json({}, 503), json({ data: { children: [] } }));
      const promise = new LiveRedditProvider(cfg, log, fn).listNewPosts('x', 5);
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toEqual([]);

      const { fn: fn2 } = fakeFetch(tokenOk(), json({}, 500), json({}, 500), json({}, 500));
      const p2 = new LiveRedditProvider(cfg, log, fn2).listNewPosts('x', 5).catch((e) => e);
      await vi.runAllTimersAsync();
      expect(await p2).toMatchObject({ category: 'SERVER', retryable: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces 429 with the server Retry-After', async () => {
    vi.useFakeTimers();
    try {
      const r429 = () => json({}, 429, { 'retry-after': '42' });
      const { fn } = fakeFetch(tokenOk(), r429(), r429(), r429());
      const p = new LiveRedditProvider(cfg, log, fn).listNewPosts('x', 5).catch((e) => e);
      await vi.runAllTimersAsync();
      const err = (await p) as ProviderError;
      expect(err.category).toBe('RATE_LIMITED');
      expect(err.retryAfterMs).toBe(42_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to call the API when the rate-limit budget is exhausted', async () => {
    const { fn } = fakeFetch(tokenOk(), json({ data: { children: [] } }, 200, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '120' }));
    const p = new LiveRedditProvider(cfg, log, fn);
    await p.listNewPosts('x', 5);
    await expect(p.listNewPosts('x', 5)).rejects.toMatchObject({ category: 'RATE_LIMITED' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never retries comment submission internally', async () => {
    const { fn } = fakeFetch(tokenOk(), new TypeError('fetch failed'));
    await expect(new LiveRedditProvider(cfg, log, fn).submitComment('t3_abc', 'hi')).rejects.toMatchObject({ category: 'NETWORK', retryable: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('parses Reddit RATELIMIT and permanent comment errors', async () => {
    const { fn } = fakeFetch(tokenOk(), json({ json: { errors: [['RATELIMIT', 'you are doing that too much. try again in 3 minutes.', 'ratelimit']] } }));
    await expect(new LiveRedditProvider(cfg, log, fn).submitComment('t3_abc', 'hi')).rejects.toMatchObject({
      category: 'RATE_LIMITED',
      retryAfterMs: 180_000,
    });
    const { fn: fn2 } = fakeFetch(tokenOk(), json({ json: { errors: [['THREAD_LOCKED', 'locked', '']] } }));
    await expect(new LiveRedditProvider(cfg, log, fn2).submitComment('t3_abc', 'hi')).rejects.toMatchObject({ category: 'FORBIDDEN', retryable: false });
  });

  it('returns the created comment id', async () => {
    const { fn, calls } = fakeFetch(tokenOk(), json({ json: { errors: [], data: { things: [{ data: { name: 't1_new' } }] } } }));
    await expect(new LiveRedditProvider(cfg, log, fn).submitComment('t3_abc', 'hello')).resolves.toEqual({ commentId: 't1_new' });
    expect(String(calls[1]!.init!.body)).toContain('thing_id=t3_abc');
  });
});

describe('error helpers and backoff', () => {
  it('classifies HTTP statuses', () => {
    expect(classifyHttpStatus(429)).toEqual({ category: 'RATE_LIMITED', retryable: true });
    expect(classifyHttpStatus(503).retryable).toBe(true);
    expect(classifyHttpStatus(403)).toEqual({ category: 'FORBIDDEN', retryable: false });
  });

  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('10')).toBe(10_000);
    expect(parseRetryAfter(new Date(Date.now() + 5000).toUTCString(), Date.now())).toBeGreaterThan(3000);
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('uses exponential backoff, honors server hints, and is bounded', () => {
    expect(publishBackoff(1)).toBe(5_000);
    expect(publishBackoff(3)).toBe(20_000);
    expect(publishBackoff(1, Object.assign(new Error('x'), { retryAfterMs: 60_000 }))).toBe(60_000);
    expect(publishBackoff(30)).toBe(15 * 60_000);
  });
});
