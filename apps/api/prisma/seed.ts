import { hashPassword } from '../src/auth/auth.ts';
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/lib/db.ts';

/**
 * Idempotent local/dev seed:
 *  - an ADMIN user from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *  - singleton rows with fail-closed defaults (publishing paused, platform authorization UNKNOWN)
 *  - a placeholder brand profile (edit it in the dashboard; nothing here is a real company claim)
 *  - policies for the synthetic demo_ communities used by DEMO mode. These are fictional and are
 *    never queried on Reddit; they exist to demonstrate each policy outcome.
 */
const cfg = loadConfig();
const db = createDb(cfg.DATABASE_URL);
const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  if (!email || password.length < 12) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 12 chars) before seeding.');
  }
  await db.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: await hashPassword(password), role: 'ADMIN' },
  });

  await db.systemState.upsert({ where: { id: 'system' }, update: {}, create: { id: 'system' } });
  await db.platformAuthorization.upsert({ where: { id: 'platform' }, update: {}, create: { id: 'platform' } });
  await db.discoverySettings.upsert({
    where: { id: 'discovery' },
    update: {},
    create: { id: 'discovery', exclusions: ['giveaway', 'promo code'], maxPostsPerRun: 25, minRelevanceForDraft: 0.6 },
  });

  if (!(await db.brandProfile.findFirst())) {
    await db.brandProfile.create({
      data: {
        name: 'CareerConnect',
        description: 'Placeholder description. Replace with an accurate, reviewed company description.',
        audience: 'Early-career job seekers and career changers.',
        capabilities: [],
        verifiedFacts: [],
        prohibitedClaims: ['guaranteed job offer', 'guaranteed interview', 'used by Fortune 500 recruiters'],
        approvedUrls: [],
        disclosureText: 'Disclosure: this reply mentions a product from the company that operates this assistant.',
        useCases: [],
        promotionCommunities: [],
      },
    });
  }

  const demoPolicies = [
    {
      communityName: 'demo_careeradvice',
      ruleSummary: 'DEMO: fictional community. Career questions welcome; automated helpers allowed if labeled; no self-promotion.',
      knownRestrictions: ['No self-promotion or links', 'Bots must be clearly labeled'],
      authorizationStatus: 'APPROVED' as const,
      automationAllowed: true,
      promotionAllowed: false,
      discoveryEnabled: true,
      lastReviewedAt: daysAgo(2),
    },
    {
      communityName: 'demo_resumes',
      ruleSummary: 'DEMO: fictional community. Resume reviews only; moderators do not permit automated comments.',
      knownRestrictions: ['No automated comments', 'Personal data must be redacted'],
      authorizationStatus: 'APPROVED' as const,
      automationAllowed: false,
      promotionAllowed: false,
      discoveryEnabled: true,
      lastReviewedAt: daysAgo(5),
    },
    {
      communityName: 'demo_cscareers',
      ruleSummary: 'DEMO: fictional community. Software career discussion. Rules review is intentionally stale.',
      knownRestrictions: ['No recruiting posts'],
      authorizationStatus: 'APPROVED' as const,
      automationAllowed: true,
      promotionAllowed: false,
      discoveryEnabled: true,
      lastReviewedAt: daysAgo(60),
    },
    {
      communityName: 'demo_unreviewed',
      ruleSummary: '',
      knownRestrictions: [],
      authorizationStatus: 'UNKNOWN' as const,
      automationAllowed: false,
      promotionAllowed: false,
      discoveryEnabled: true,
      lastReviewedAt: null,
    },
  ];
  for (const p of demoPolicies) {
    await db.subredditPolicy.upsert({ where: { communityName: p.communityName }, update: {}, create: p });
  }
  console.log(`Seed complete. Admin: ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
