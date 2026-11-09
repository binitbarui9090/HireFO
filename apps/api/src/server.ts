import { createServer } from 'node:http';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './db/prisma.js';
import { closeRedis } from './db/redis.js';
import { createApp } from './http/app.js';
import { closeQueue } from './queue/executionQueue.js';
import { closeRealtime, initRealtime } from './realtime/socket.js';

async function main(): Promise<void> {
  const cfg = config();

  // Fail fast if Postgres is unreachable: a half-up API is worse than none.
  await prisma.$queryRaw`SELECT 1`;

  const app = createApp();
  const httpServer = createServer(app);
  initRealtime(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(cfg.PORT, cfg.HOST, resolve));

  logger.info(
    {
      port: cfg.PORT,
      host: cfg.HOST,
      env: cfg.NODE_ENV,
      runner: cfg.EXECUTION_RUNNER,
      aiProvider: cfg.AI_PROVIDER,
      webOrigins: cfg.webOrigins,
    },
    'HireFO API listening',
  );

  if (cfg.EXECUTION_RUNNER === 'LOCAL_SUBPROCESS') {
    logger.warn(
      'EXECUTION_RUNNER=LOCAL_SUBPROCESS — submissions run as restricted child processes on this host. ' +
        'Development only; see docs/SECURITY.md.',
    );
  }
  if (!cfg.aiEnabled) {
    logger.warn('AI_PROVIDER=disabled — copilot endpoints return a configuration notice, not model output.');
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const timer = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 15_000);
    timer.unref();

    await closeRealtime().catch((err) => logger.error({ err }, 'socket close failed'));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await closeQueue().catch((err) => logger.error({ err }, 'queue close failed'));
    await closeRedis().catch((err) => logger.error({ err }, 'redis close failed'));
    await prisma.$disconnect().catch((err) => logger.error({ err }, 'prisma disconnect failed'));

    clearTimeout(timer);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

main().catch((err) => {
  // config() throws a readable message for bad env, so print it plainly.
  console.error(`\nHireFO API failed to start:\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
