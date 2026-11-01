export interface RedditPost {
  /** Fullname, e.g. t3_abc123 (or syn_… for synthetic fixtures). */
  externalId: string;
  community: string;
  title: string;
  body: string;
  permalink: string | null;
  createdAt: Date;
  locked: boolean;
  removedOrDeleted: boolean;
}

export interface PostStatus {
  available: boolean;
  reason?: 'removed' | 'deleted' | 'locked' | 'archived' | 'not_found';
}

export interface RedditProvider {
  readonly kind: 'mock' | 'live';
  listNewPosts(community: string, limit: number): Promise<RedditPost[]>;
  getTopComments(externalId: string, limit: number): Promise<string[]>;
  getPostStatus(externalId: string): Promise<PostStatus>;
  /** Returns the id of an existing comment by the bot account on this post, if any (duplicate-submission guard). */
  findOwnComment(externalId: string): Promise<string | null>;
  submitComment(externalId: string, text: string): Promise<{ commentId: string }>;
  checkConnectivity(): Promise<{ ok: boolean; detail: string }>;
}
