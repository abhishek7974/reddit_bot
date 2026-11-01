import { randomUUID } from 'node:crypto';
import { ProviderError } from '../lib/errors.ts';
import { syntheticPosts } from './fixtures.ts';
import type { PostStatus, RedditPost, RedditProvider } from './types.ts';

/**
 * In-memory Reddit stand-in. Never performs network I/O.
 * Tests can queue failures with `failNextSubmit` to exercise retry/circuit-breaker paths.
 */
export class MockRedditProvider implements RedditProvider {
  readonly kind = 'mock' as const;
  private posts = syntheticPosts();
  private comments = new Map<string, string>(); // postId -> commentId
  readonly submitted: { externalId: string; text: string; commentId: string }[] = [];
  private failures: ProviderError[] = [];

  failNextSubmit(...errors: ProviderError[]): void {
    this.failures.push(...errors);
  }

  /** Simulate an "ambiguous" failure: the comment is stored but the caller sees a network error. */
  submitThenFailNetwork = false;

  async listNewPosts(community: string, limit: number): Promise<RedditPost[]> {
    return this.posts
      .filter((p) => p.community.toLowerCase() === community.toLowerCase())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(({ comments: _c, ...p }) => p);
  }

  async getTopComments(externalId: string, limit: number): Promise<string[]> {
    return (this.posts.find((p) => p.externalId === externalId)?.comments ?? []).slice(0, limit);
  }

  async getPostStatus(externalId: string): Promise<PostStatus> {
    const p = this.posts.find((x) => x.externalId === externalId);
    if (!p) return { available: false, reason: 'not_found' };
    if (p.removedOrDeleted) return { available: false, reason: 'removed' };
    if (p.locked) return { available: false, reason: 'locked' };
    return { available: true };
  }

  async findOwnComment(externalId: string): Promise<string | null> {
    return this.comments.get(externalId) ?? null;
  }

  async submitComment(externalId: string, text: string): Promise<{ commentId: string }> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    const commentId = `mock_c_${randomUUID().slice(0, 8)}`;
    this.comments.set(externalId, commentId);
    this.submitted.push({ externalId, text, commentId });
    if (this.submitThenFailNetwork) {
      this.submitThenFailNetwork = false;
      throw new ProviderError('NETWORK', 'socket hang up (simulated after submission)', true);
    }
    return { commentId };
  }

  async checkConnectivity() {
    return { ok: true, detail: 'Mock provider (synthetic data, no network).' };
  }
}
