import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import * as Sentry from '@sentry/node';
import { SESSION_COOKIE } from '@careerconnect/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { resolveSession } from './auth/auth.ts';
import { APP_VERSION } from './config.ts';
import type { AppContext } from './context.ts';
import { AppError } from './lib/errors.ts';
import { loggerOptions } from './lib/logger.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { brandRoutes } from './routes/brand.ts';
import { conversationRoutes } from './routes/conversations.ts';
import { dashboardRoutes } from './routes/dashboard.ts';
import { draftRoutes } from './routes/drafts.ts';
import { policyRoutes } from './routes/policies.ts';

export type App = FastifyInstance;

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<App> {
  const app = Fastify({
    logger: opts.logger === false ? false : loggerOptions(ctx.cfg),
    trustProxy: ctx.cfg.NODE_ENV === 'production',
    bodyLimit: 256 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false }); // JSON API; Swagger UI needs inline assets
  await app.register(cors, { origin: [ctx.cfg.WEB_ORIGIN], credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, c) => ({
      statusCode: 429,
      error: { code: 'RATE_LIMITED', message: `Too many requests; retry in ${Math.ceil(c.ttl / 1000)}s.` },
    }),
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CareerConnect AI API',
        version: APP_VERSION,
        description:
          'Compliance-first career-discussion assistant. Publication is decided by a deterministic policy engine, never by the LLM.',
      },
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
          csrf: { type: 'apiKey', in: 'header', name: 'x-csrf-token' },
        },
      },
      security: [{ session: [], csrf: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    req.user = await resolveSession(ctx, req.cookies[SESSION_COOKIE]);
  });

  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })) },
      });
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send(err);
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: (err as { code?: string }).code ?? 'BAD_REQUEST', message: (err as Error).message } });
    }
    req.log.error({ err }, 'unhandled error');
    if (ctx.cfg.SENTRY_DSN) Sentry.captureException(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Internal server error.' } });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));

  app.get('/api/health', { schema: { tags: ['system'], security: [] } }, async () => ({
    status: 'ok',
    mode: ctx.cfg.APP_MODE,
    version: APP_VERSION,
  }));

  await app.register(authRoutes(ctx), { prefix: '/api/auth' });
  await app.register(dashboardRoutes(ctx), { prefix: '/api' });
  await app.register(conversationRoutes(ctx), { prefix: '/api' });
  await app.register(draftRoutes(ctx), { prefix: '/api/drafts' });
  await app.register(policyRoutes(ctx), { prefix: '/api/policies' });
  await app.register(brandRoutes(ctx), { prefix: '/api/brand-profile' });
  await app.register(adminRoutes(ctx), { prefix: '/api' });

  return app;
}
