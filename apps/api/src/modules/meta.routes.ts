import { Router } from 'express';
import {
  AI_GUARDRAIL_NOTICE,
  AI_SUGGESTION_KIND_LABELS,
  CATEGORY_LABELS,
  DIFFICULTIES,
  EXECUTION_LIMITS,
  LANGUAGES,
  QUESTION_CATEGORIES,
  RECOMMENDATION_LABELS,
} from '@hirefo/shared';
import { config } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { redis } from '../db/redis.js';
import { asyncHandler } from '../lib/async.js';
import { queueHealth } from '../queue/executionQueue.js';
import { ANALYTICS_DISCLAIMER } from '../services/analytics.js';

export const metaRouter = Router();

/** Liveness: the process is up. Never touches dependencies. */
metaRouter.get('/livez', (_req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

/** Readiness: every dependency the API needs to serve traffic. */
metaRouter.get(
  '/readyz',
  asyncHandler(async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks['postgres'] = { ok: true };
    } catch (err) {
      checks['postgres'] = { ok: false, detail: err instanceof Error ? err.message : 'unreachable' };
    }

    try {
      const pong = await redis().ping();
      checks['redis'] = { ok: pong === 'PONG' };
    } catch (err) {
      checks['redis'] = { ok: false, detail: err instanceof Error ? err.message : 'unreachable' };
    }

    const queue = await queueHealth();
    checks['executionQueue'] = {
      ok: queue.reachable,
      detail: `waiting=${queue.waiting} active=${queue.active} failed=${queue.failed}`,
    };

    const ok = Object.values(checks).every((c) => c.ok);
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'degraded', checks, queue });
  }),
);

/**
 * Static capability descriptor the web app reads at boot so the UI never guesses
 * what the backend supports (which languages are executable, whether AI is
 * configured, which runner is active).
 */
metaRouter.get('/capabilities', (_req, res) => {
  const cfg = config();
  res.json({
    languages: Object.values(LANGUAGES).map((l) => ({
      id: l.id,
      label: l.label,
      monacoId: l.monacoId,
      executable: l.executable,
      executionNote: l.executionNote,
    })),
    difficulties: DIFFICULTIES,
    categories: QUESTION_CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABELS[c] })),
    recommendations: RECOMMENDATION_LABELS,
    aiSuggestionKinds: AI_SUGGESTION_KIND_LABELS,
    execution: {
      runner: cfg.EXECUTION_RUNNER,
      isolated: cfg.EXECUTION_RUNNER === 'DOCKER',
      limits: EXECUTION_LIMITS,
      note:
        cfg.EXECUTION_RUNNER === 'DOCKER'
          ? 'Submissions run in a single-use container: no network, read-only root filesystem, non-root user, cpu/memory/pids capped.'
          : 'DEVELOPMENT FALLBACK: submissions run as a restricted child process on the API host. Weaker isolation than Docker — see docs/SECURITY.md.',
    },
    ai: {
      enabled: cfg.aiEnabled,
      provider: cfg.AI_PROVIDER,
      model: cfg.aiEnabled ? cfg.AI_MODEL : null,
      guardrailNotice: AI_GUARDRAIL_NOTICE,
      disabledReason: cfg.aiEnabled
        ? null
        : 'AI_PROVIDER is set to "disabled". Copilot requests return a configuration notice instead of model output.',
    },
    analyticsDisclaimer: ANALYTICS_DISCLAIMER,
  });
});
