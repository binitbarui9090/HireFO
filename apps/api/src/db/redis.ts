import { Redis, type RedisOptions } from 'ioredis';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

const baseOptions: RedisOptions = {
  // BullMQ requires this to be null on its connections.
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
};

export function createRedis(role: string, overrides: RedisOptions = {}): Redis {
  const client = new Redis(config().REDIS_URL, { ...baseOptions, ...overrides });
  client.on('error', (err) => logger.error({ err, role }, 'redis error'));
  client.on('reconnecting', () => logger.warn({ role }, 'redis reconnecting'));
  return client;
}

let shared: Redis | null = null;

/** General-purpose connection for presence, rate limiting and doc locks. */
export function redis(): Redis {
  shared ??= createRedis('app');
  return shared;
}

export async function closeRedis(): Promise<void> {
  if (shared) {
    await shared.quit().catch(() => shared?.disconnect());
    shared = null;
  }
}
