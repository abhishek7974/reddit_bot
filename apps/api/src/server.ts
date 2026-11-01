import { buildApp } from './app.ts';
import { createAppContext } from './bootstrap.ts';

const { ctx, redis, queues } = createAppContext();
const app = await buildApp(ctx);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await queues.close();
  redis.disconnect();
  await ctx.db.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: ctx.cfg.API_PORT, host: ctx.cfg.API_HOST });
app.log.info({ mode: ctx.cfg.APP_MODE, llm: ctx.llm.name, reddit: ctx.discovery?.kind ?? 'disabled' }, 'CareerConnect API ready');
