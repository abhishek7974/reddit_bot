import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { CSRF_HEADER, SESSION_COOKIE, type Role, type SessionResponse } from '@careerconnect/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.ts';
import { AppError } from '../lib/errors.ts';

const ROLE_RANK: Record<Role, number> = { VIEWER: 1, REVIEWER: 2, ADMIN: 3 };

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
  csrfToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export const hashPassword = (password: string) => hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Constant-time dummy verification target so unknown emails take as long as wrong passwords.
let dummyHash: Promise<string> | null = null;

export async function login(ctx: AppContext, email: string, password: string): Promise<{ token: string; session: SessionResponse }> {
  const user = await ctx.db.user.findUnique({ where: { email } });
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  let ok = false;
  if (user?.passwordHash && !user.disabled) ok = await verify(user.passwordHash, password).catch(() => false);
  else await verify(await dummyHash, password).catch(() => false);
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(ctx.now().getTime() + ctx.cfg.SESSION_TTL_HOURS * 3_600_000);
  await ctx.db.session.create({ data: { tokenHash: sha256(token), csrfToken, userId: user.id, expiresAt } });
  // Opportunistic cleanup of expired sessions.
  await ctx.db.session.deleteMany({ where: { expiresAt: { lt: ctx.now() } } });
  return {
    token,
    session: { user: { id: user.id, email: user.email, role: user.role }, csrfToken, expiresAt: expiresAt.toISOString() },
  };
}

export async function resolveSession(ctx: AppContext, token: string | undefined): Promise<AuthUser | null> {
  if (!token || token.length > 200) return null;
  const session = await ctx.db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt <= ctx.now() || session.user.disabled) return null;
  return { id: session.user.id, email: session.user.email, role: session.user.role, sessionId: session.id, csrfToken: session.csrfToken };
}

export function cookieOptions(ctx: AppContext, expires?: Date) {
  return {
    httpOnly: true,
    secure: ctx.cfg.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Route guard: authenticated, minimum role, and CSRF token on mutating requests. */
export function requireRole(min: Role) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Login required.');
    if (ROLE_RANK[req.user.role] < ROLE_RANK[min]) {
      throw new AppError(403, 'FORBIDDEN', `Requires ${min} role.`);
    }
    if (MUTATING.has(req.method)) {
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== 'string' || !safeEqual(header, req.user.csrfToken)) {
        throw new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token.');
      }
    }
  };
}

export { SESSION_COOKIE };
