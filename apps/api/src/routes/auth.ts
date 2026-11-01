import { createHash } from 'node:crypto';
import { SESSION_COOKIE, loginBody, type SessionResponse } from '@careerconnect/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { cookieOptions, login, requireRole } from '../auth/auth.ts';
import type { AppContext } from '../context.ts';
import { audit } from '../lib/audit.ts';
import { AppError } from '../lib/errors.ts';

export const authRoutes = (ctx: AppContext): FastifyPluginAsyncZod => async (app) => {
  app.post(
    '/login',
    {
      schema: { tags: ['auth'], body: loginBody, security: [] },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      try {
        const { token, session } = await login(ctx, req.body.email, req.body.password);
        await audit(ctx.db, { actorId: session.user.id, action: 'auth.login', entityType: 'User', entityId: session.user.id });
        reply.setCookie(SESSION_COOKIE, token, cookieOptions(ctx, new Date(session.expiresAt)));
        return session;
      } catch (err) {
        if (err instanceof AppError && err.code === 'INVALID_CREDENTIALS') {
          // Log a hash, not the email, to avoid storing typed-in identifiers of unknown people.
          const emailHash = createHash('sha256').update(req.body.email).digest('hex').slice(0, 16);
          await audit(ctx.db, { actorId: null, action: 'auth.login_failed', entityType: 'User', metadata: { emailHash, ip: req.ip } });
        }
        throw err;
      }
    },
  );

  app.post('/logout', { schema: { tags: ['auth'] }, preHandler: requireRole('VIEWER') }, async (req, reply) => {
    await ctx.db.session.deleteMany({ where: { id: req.user!.sessionId } });
    await audit(ctx.db, { actorId: req.user!.id, action: 'auth.logout', entityType: 'User', entityId: req.user!.id });
    reply.clearCookie(SESSION_COOKIE, cookieOptions(ctx));
    return { ok: true };
  });

  app.get('/me', { schema: { tags: ['auth'] }, preHandler: requireRole('VIEWER') }, async (req): Promise<SessionResponse> => {
    const session = await ctx.db.session.findUniqueOrThrow({ where: { id: req.user!.sessionId } });
    await ctx.db.session.update({ where: { id: session.id }, data: { lastSeenAt: ctx.now() } });
    return {
      user: { id: req.user!.id, email: req.user!.email, role: req.user!.role },
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt.toISOString(),
    };
  });
};
