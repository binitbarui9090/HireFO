import { PrismaClient } from '@prisma/client';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { EXECUTION_JOB_NAME, type ExecutionJobPayload } from '@hirefo/shared';
import { config } from './config.js';
import { logger } from './logger.js';
import { processExecutionJob } from './processor.js';
import { sandboxRunner } from './runners/index.js';

async function main(): Promise<void> {
  const cfg = config();
  const prisma = new PrismaClient({ datasources: { db: { url: cfg.DATABASE_URL } } });
  await prisma.$queryRaw`SELECT 1`;

  const connection = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
  const publisher = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on('error', (err) => logger.error({ err }, 'redis (queue) error'));
  publisher.on('error', (err) => logger.error({ err }, 'redis (publisher) error'));

  const runner = sandboxRunner();
  const preflight = await runner.preflight();
  if (!preflight.ok) {
    // Refuse to consume jobs we cannot run: leaving them queued is better than
    // failing every submission one by one.
    logger.fatal({ detail: preflight.detail }, 'sandbox preflight failed');
    throw new Error(preflight.detail);
  }
  logger[runner.kind === 'DOCKER' ? 'info' : 'warn'](
    { runner: runner.kind, detail: preflight.detail },
    'sandbox ready',
  );

  const worker = new Worker<ExecutionJobPayload>(
    cfg.EXECUTION_QUEUE_NAME,
    async (job: Job<ExecutionJobPayload>) => {
      if (job.name !== EXECUTION_JOB_NAME) {
        throw new Error(`Unknown job name "${job.name}".`);
      }
      return processExecutionJob(job.data, { prisma, publisher }, job.attemptsMade + 1);
    },
    {
      connection,
      concurrency: cfg.EXECUTION_CONCURRENCY,
      // A worker that dies mid-container must not leave the job locked forever.
      lockDuration: 120_000,
      stalledInterval: 30_000,
      maxStalledCount: 1,
    },
  );

  worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, result }, 'job completed');
  });

  worker.on('failed', async (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'job failed');
    if (!job) return;
    const willRetry = job.attemptsMade < (job.opts.attempts ?? 1);
    if (willRetry) return;

    // Last attempt: make sure the database reflects a terminal state so the UI
    // stops showing a spinner forever.
    const executionJobId = job.data?.executionJobId;
    if (!executionJobId) return;
    await prisma.executionJob
      .updateMany({
        where: { id: executionJobId, finishedAt: null },
        data: {
          status: 'ERROR',
          finishedAt: new Date(),
          errorMessage: `Execution failed after ${job.attemptsMade} attempt(s): ${err.message}`.slice(0, 1000),
        },
      })
      .catch((e: unknown) => logger.error({ err: e }, 'failed to mark job errored'));
  });

  worker.on('stalled', (jobId) => logger.warn({ jobId }, 'job stalled'));
  worker.on('error', (err) => logger.error({ err }, 'worker error'));

  logger.info(
    {
      queue: cfg.EXECUTION_QUEUE_NAME,
      concurrency: cfg.EXECUTION_CONCURRENCY,
      runner: runner.kind,
      imageTag: cfg.RUNTIME_IMAGE_TAG,
    },
    'HireFO execution worker started',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down worker');
    // `close(false)` lets in-flight containers finish before we exit.
    await worker.close().catch((err) => logger.error({ err }, 'worker close failed'));
    await Promise.allSettled([connection.quit(), publisher.quit()]);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'));
}

main().catch((err) => {
  console.error(
    `\nHireFO worker failed to start:\n${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
