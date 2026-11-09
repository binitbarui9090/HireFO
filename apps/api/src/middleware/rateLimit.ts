import rateLimit, { type Options } from 'express-rate-limit';
import { EXECUTION_LIMITS } from '@hirefo/shared';
import { config } from '../config/env.js';
import { clientIp } from '../lib/http.js';

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Tests exercise many requests in a row; limits are not the unit under test.
  skip: () => config().isTest,
  message: { error: { code: 'rate_limited', message: 'Too many requests. Slow down and try again.' } },
};

/** Keyed by authenticated user when available, otherwise by IP. */
const userOrIp = (req: { auth?: { user: { id: string } } } & Parameters<typeof clientIp>[0]) =>
  req.auth?.user.id ?? clientIp(req) ?? 'unknown';

export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60_000,
  limit: 20,
  keyGenerator: (req) => clientIp(req) ?? 'unknown',
});

export const apiLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 600,
  keyGenerator: userOrIp as never,
});

export const executionLimiter = rateLimit({
  ...shared,
  windowMs: EXECUTION_LIMITS.rateLimit.windowMs,
  limit: EXECUTION_LIMITS.rateLimit.max,
  keyGenerator: userOrIp as never,
  message: {
    error: {
      code: 'rate_limited',
      message: 'You are running code too quickly. Wait a moment and try again.',
    },
  },
});

export const aiLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 20,
  keyGenerator: userOrIp as never,
  message: {
    error: { code: 'rate_limited', message: 'Copilot requests are rate limited. Try again shortly.' },
  },
});
