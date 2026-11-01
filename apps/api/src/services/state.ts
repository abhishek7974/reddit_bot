import type { PublishingStateDto } from '@careerconnect/shared';
import { redditCredentialsPresent } from '../config.ts';
import type { AppContext } from '../context.ts';
import type { Db } from '../lib/db.ts';

// Singleton rows are created on first access with fail-closed defaults (paused, UNKNOWN authorizations).

export async function getSystemState(db: Db) {
  return db.systemState.upsert({ where: { id: 'system' }, update: {}, create: { id: 'system' } });
}

export async function getPlatformAuthorization(db: Db) {
  return db.platformAuthorization.upsert({ where: { id: 'platform' }, update: {}, create: { id: 'platform' } });
}

export async function getDiscoverySettings(db: Db) {
  return db.discoverySettings.upsert({ where: { id: 'discovery' }, update: {}, create: { id: 'discovery' } });
}

export async function getBrandProfile(db: Db) {
  const existing = await db.brandProfile.findFirst({ orderBy: { createdAt: 'asc' } });
  return existing ?? db.brandProfile.create({ data: { name: 'Unconfigured brand' } });
}

/** Reasons publication is impossible regardless of the pause flag (configuration-level blockers). */
export async function publishingBlockers(ctx: AppContext): Promise<string[]> {
  const { cfg, db } = ctx;
  const out: string[] = [];
  if (cfg.PUBLISHING_HARD_DISABLED) out.push('PUBLISHING_HARD_DISABLED is set in the environment.');
  if (cfg.APP_MODE === 'DRAFT_ONLY') out.push('DRAFT_ONLY mode never publishes.');
  if (!cfg.BOT_DISCLOSURE_TEXT) out.push('BOT_DISCLOSURE_TEXT (automated-activity disclosure) is not configured.');
  if (cfg.APP_MODE === 'LIVE') {
    if (!redditCredentialsPresent(cfg)) out.push('Reddit OAuth credentials are not configured.');
    const p = await getPlatformAuthorization(db);
    if (p.apiAccessAuthorized !== 'APPROVED') out.push(`Reddit API access authorization is ${p.apiAccessAuthorized}.`);
    if (p.commercialUseApproved !== 'APPROVED') out.push(`Commercial-use approval is ${p.commercialUseApproved}.`);
    if (p.accountRegisteredAndLabeled !== 'APPROVED') out.push(`Bot account registration/labeling is ${p.accountRegisteredAndLabeled}.`);
    if (!cfg.PUBLISH_MAX_PER_HOUR || !cfg.PUBLISH_MAX_PER_DAY || !cfg.PUBLISH_MAX_PER_COMMUNITY_PER_DAY)
      out.push('Publish rate limits are not configured.');
  }
  if (cfg.APP_MODE === 'DEMO') out.push('DEMO mode: only simulated publication of synthetic data is possible.');
  return out;
}

export async function publishingState(ctx: AppContext): Promise<PublishingStateDto> {
  const s = await getSystemState(ctx.db);
  const pausedBy = s.pausedById
    ? (await ctx.db.user.findUnique({ where: { id: s.pausedById }, select: { email: true } }))?.email ?? null
    : null;
  return {
    mode: ctx.cfg.APP_MODE,
    globalPause: s.globalPause,
    pauseReason: s.pauseReason,
    pausedAt: s.pausedAt?.toISOString() ?? null,
    pausedBy,
    blockedReasons: await publishingBlockers(ctx),
  };
}
