import { Queue, QueueEvents } from 'bullmq';
import { EXECUTION_JOB_NAME, type ExecutionJobPayload } from '@hirefo/shared';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { createRedis } from '../db/redis.js';

let queue: Queue<ExecutionJobPayload> | null = null;
let events: QueueEvents | null = null;

export function executionQueue(): Queue<ExecutionJobPayload> {
  queue ??= new Queue<ExecutionJobPayload>(config().EXECUTION_QUEUE_NAME, {
    connection: createRedis('execution-queue'),
    defaultJobOptions: {
      // Untrusted-code jobs are not retried blindly: a crash loop would be a free
      // amplification primitive. One retry only, with backoff, for infra flakes.
      attempts: 2,
      backoff: { type: 'fixed', delay: 2_000 },
      removeOnComplete: { age: 3_600, count: 500 },
      removeOnFail: { age: 86_400, count: 500 },
    },
  });
  return queue;
}

export function executionQueueEvents(): QueueEvents {
  events ??= new QueueEvents(config().EXECUTION_QUEUE_NAME, {
    connection: createRedis('execution-queue-events'),
  });
  return events;
}

export async function enqueueExecution(payload: ExecutionJobPayload): Promise<string> {
  // jobId is the ExecutionJob row id, which makes enqueueing idempotent: a retried
  // HTTP request cannot create a second run for the same submission.
  const job = await executionQueue().add(EXECUTION_JOB_NAME, payload, {
    jobId: payload.executionJobId,
  });
  logger.info(
    { executionJobId: payload.executionJobId, language: payload.language, cases: payload.testCases.length },
    'execution job enqueued',
  );
  return job.id ?? payload.executionJobId;
}

export interface QueueHealth {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  /** False when Redis cannot be reached. */
  reachable: boolean;
}

export async function queueHealth(): Promise<QueueHealth> {
  // The Queue constructor itself can throw (e.g. an invalid queue name), so it is
  // inside the try: a health check must report a problem, never raise one.
  let q: Queue<ExecutionJobPayload>;
  try {
    q = executionQueue();
    const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    return {
      name: q.name,
      waiting: counts['waiting'] ?? 0,
      active: counts['active'] ?? 0,
      completed: counts['completed'] ?? 0,
      failed: counts['failed'] ?? 0,
      delayed: counts['delayed'] ?? 0,
      reachable: true,
    };
  } catch (err) {
    logger.error({ err }, 'queue health check failed');
    return {
      name: config().EXECUTION_QUEUE_NAME,
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      reachable: false,
    };
  }
}

export async function closeQueue(): Promise<void> {
  await Promise.allSettled([queue?.close(), events?.close()]);
  queue = null;
  events = null;
}
