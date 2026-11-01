import type { AppConfig } from '../config.ts';
import { ProviderError, classifyHttpStatus, parseRetryAfter } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import type { PostStatus, RedditPost, RedditProvider } from './types.ts';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';
const READ_RETRIES = 2;
const EXCERPT_CHARS = 1500;
const COMMENT_CHARS = 400;

type FetchFn = typeof fetch;

interface Listing<T> {
  data: { children: { kind: string; data: T }[] };
}
interface RawPost {
  name: string;
  subreddit: string;
  title: string;
  selftext: string;
  permalink: string;
  created_utc: number;
  locked: boolean;
  archived?: boolean;
  removed_by_category: string | null;
  author: string;
}
interface RawComment {
  name: string;
  body: string;
  link_id: string;
  author: string;
  stickied?: boolean;
}

/**
 * Reddit Data API client using OAuth2 (refresh-token grant) for a dedicated, labeled bot account.
 * - Official endpoints only; no scraping, no browser automation.
 * - Honors X-Ratelimit-* headers and Retry-After; bounded retries for reads only.
 * - submitComment never retries internally (the publish worker owns retries + duplicate guards).
 * Usage requires Reddit's approval for your use case — authentication alone is not authorization.
 */
export class LiveRedditProvider implements RedditProvider {
  readonly kind = 'live' as const;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private rateRemaining: number | null = null;
  private rateResetAt = 0;

  constructor(
    private cfg: AppConfig,
    private log: Logger,
    private fetchFn: FetchFn = fetch,
  ) {
    if (!cfg.REDDIT_CLIENT_ID || !cfg.REDDIT_CLIENT_SECRET || !cfg.REDDIT_REFRESH_TOKEN || !cfg.REDDIT_USER_AGENT) {
      throw new Error('LiveRedditProvider requires REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN and REDDIT_USER_AGENT');
    }
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;
    const basic = Buffer.from(`${this.cfg.REDDIT_CLIENT_ID}:${this.cfg.REDDIT_CLIENT_SECRET}`).toString('base64');
    let res: Response;
    try {
      res = await this.fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'User-Agent': this.cfg.REDDIT_USER_AGENT!,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.cfg.REDDIT_REFRESH_TOKEN! }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ProviderError('NETWORK', 'Reddit OAuth token request failed', true);
    }
    if (!res.ok) {
      const { category, retryable } = classifyHttpStatus(res.status);
      throw new ProviderError(category === 'FORBIDDEN' ? 'AUTH' : category, `Reddit OAuth failed (${res.status})`, retryable);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!json.access_token) throw new ProviderError('AUTH', `Reddit OAuth error: ${json.error ?? 'no token'}`, false);
    this.accessToken = json.access_token;
    this.tokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  private trackRateLimit(res: Response): void {
    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(remaining)) this.rateRemaining = remaining;
    if (Number.isFinite(reset)) this.rateResetAt = Date.now() + reset * 1000;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: URLSearchParams, retries = 0): Promise<T> {
    if (this.rateRemaining !== null && this.rateRemaining < 1 && Date.now() < this.rateResetAt) {
      throw new ProviderError('RATE_LIMITED', 'Reddit rate limit exhausted', true, this.rateResetAt - Date.now());
    }
    const token = await this.token();
    let res: Response;
    try {
      res = await this.fetchFn(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': this.cfg.REDDIT_USER_AGENT!,
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      const err = new ProviderError('NETWORK', `Reddit ${method} ${path.split('?')[0]} network failure`, true);
      if (method === 'GET' && retries < READ_RETRIES) return this.retry<T>(method, path, body, retries, err);
      throw err;
    }
    this.trackRateLimit(res);
    if (res.status === 401 && retries === 0) {
      this.accessToken = null; // token may have been revoked/expired early; refresh once
      return this.request<T>(method, path, body, retries + 1);
    }
    if (!res.ok) {
      const { category, retryable } = classifyHttpStatus(res.status);
      const err = new ProviderError(category, `Reddit ${method} ${path.split('?')[0]} failed (${res.status})`, retryable,
        parseRetryAfter(res.headers.get('retry-after')) ??
          (category === 'RATE_LIMITED' && this.rateResetAt ? this.rateResetAt - Date.now() : undefined));
      if (method === 'GET' && retryable && retries < READ_RETRIES) return this.retry<T>(method, path, body, retries, err);
      throw err;
    }
    return (await res.json()) as T;
  }

  private async retry<T>(method: 'GET' | 'POST', path: string, body: URLSearchParams | undefined, retries: number, err: ProviderError): Promise<T> {
    const delay = Math.min(err.retryAfterMs ?? 1000 * 2 ** retries, 30_000);
    this.log.warn({ path: path.split('?')[0], delay, category: err.category }, 'reddit read retry');
    await new Promise((r) => setTimeout(r, delay));
    return this.request<T>(method, path, body, retries + 1);
  }

  async listNewPosts(community: string, limit: number): Promise<RedditPost[]> {
    const listing = await this.request<Listing<RawPost>>('GET', `/r/${encodeURIComponent(community)}/new?limit=${Math.min(limit, 100)}&raw_json=1`);
    return listing.data.children
      .filter((c) => c.kind === 't3')
      .map(({ data: p }) => ({
        externalId: p.name,
        community: p.subreddit,
        title: p.title,
        body: (p.selftext ?? '').slice(0, EXCERPT_CHARS),
        permalink: `https://www.reddit.com${p.permalink}`,
        createdAt: new Date(p.created_utc * 1000),
        locked: p.locked,
        removedOrDeleted: Boolean(p.removed_by_category) || p.author === '[deleted]' || p.selftext === '[removed]',
      }));
  }

  async getTopComments(externalId: string, limit: number): Promise<string[]> {
    const id = externalId.replace(/^t3_/, '');
    const res = await this.request<[unknown, Listing<RawComment>]>('GET', `/comments/${id}?limit=${limit}&depth=1&sort=top&raw_json=1`);
    return res[1].data.children
      .filter((c) => c.kind === 't1' && !c.data.stickied && c.data.body && c.data.body !== '[removed]' && c.data.body !== '[deleted]')
      .slice(0, limit)
      .map((c) => c.data.body.slice(0, COMMENT_CHARS));
  }

  async getPostStatus(externalId: string): Promise<PostStatus> {
    try {
      const res = await this.request<Listing<RawPost>>('GET', `/api/info?id=${encodeURIComponent(externalId)}&raw_json=1`);
      const p = res.data.children[0]?.data;
      if (!p) return { available: false, reason: 'not_found' };
      if (p.removed_by_category) return { available: false, reason: 'removed' };
      if (p.author === '[deleted]') return { available: false, reason: 'deleted' };
      if (p.locked) return { available: false, reason: 'locked' };
      if (p.archived) return { available: false, reason: 'archived' };
      return { available: true };
    } catch (err) {
      if (err instanceof ProviderError && err.category === 'NOT_FOUND') return { available: false, reason: 'not_found' };
      throw err;
    }
  }

  async findOwnComment(externalId: string): Promise<string | null> {
    const me = await this.request<{ name: string }>('GET', '/api/v1/me');
    const res = await this.request<Listing<RawComment>>('GET', `/user/${encodeURIComponent(me.name)}/comments?limit=100&sort=new&raw_json=1`);
    return res.data.children.find((c) => c.data.link_id === externalId)?.data.name ?? null;
  }

  async submitComment(externalId: string, text: string): Promise<{ commentId: string }> {
    const res = await this.request<{ json: { errors: [string, string, string][]; data?: { things: { data: { name: string } }[] } } }>(
      'POST',
      '/api/comment',
      new URLSearchParams({ api_type: 'json', thing_id: externalId, text }),
    );
    const errors = res.json.errors ?? [];
    if (errors.length) {
      const [code, message] = errors[0]!;
      if (code === 'RATELIMIT') {
        const m = /(\d+)\s*(minute|second)/i.exec(message ?? '');
        const ms = m ? Number(m[1]) * (m[2]!.toLowerCase().startsWith('minute') ? 60_000 : 1000) : undefined;
        throw new ProviderError('RATE_LIMITED', `Reddit RATELIMIT: ${message}`, true, ms);
      }
      if (code === 'THREAD_LOCKED' || code === 'DELETED_LINK' || code === 'TOO_OLD') {
        throw new ProviderError('FORBIDDEN', `Reddit refused comment: ${code}`, false);
      }
      throw new ProviderError('VALIDATION', `Reddit refused comment: ${code}`, false);
    }
    const name = res.json.data?.things[0]?.data.name;
    if (!name) throw new ProviderError('UNKNOWN', 'Reddit response missing comment id', false);
    return { commentId: name };
  }

  async checkConnectivity() {
    try {
      const me = await this.request<{ name: string }>('GET', '/api/v1/me');
      return { ok: true, detail: `Authenticated as u/${me.name}. Authentication is not commercial authorization.` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
}
