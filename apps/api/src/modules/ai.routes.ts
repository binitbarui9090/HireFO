import { Router } from 'express';
import { z } from 'zod';
import { AI_GUARDRAIL_NOTICE, aiSuggestionRequestSchema } from '@hirefo/shared';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { asyncHandler } from '../lib/async.js';
import { clientIp, parseBody, parseParams, userAgent } from '../lib/http.js';
import { authenticate, orgContext, requireAuth, requireRole, resolveInterviewAccess, withOrg } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { resolveProvider } from '../services/ai/index.js';
import {
  assertWithinBudget,
  buildContext,
  CopilotUnavailable,
  finalise,
  listSuggestions,
  requestSuggestion,
  usageSummary,
} from '../services/ai/copilot.js';
import { buildUserPrompt, SYSTEM_PROMPT } from '../services/ai/prompts.js';
import { LlmError } from '../services/ai/provider.js';

export const aiRouter = Router();

// The copilot is strictly interviewer-facing. Candidates get no access at all —
// not a filtered view — so suggestions cannot leak into the candidate's session.
aiRouter.use(authenticate, withOrg, requireRole('INTERVIEWER'));

const idParam = z.object({ id: z.string().min(8).max(64) });

const actorOf = (req: Parameters<Parameters<Router['get']>[1]>[0]) => ({
  userId: requireAuth(req).user.id,
  organizationId: orgContext(req).organizationId,
  ip: clientIp(req),
  userAgent: userAgent(req),
});

/** Shape returned when the copilot cannot run. Never fabricated model output. */
function unavailablePayload(err: CopilotUnavailable) {
  return {
    available: false,
    reason: err.reason,
    message: err.detail,
    guardrailNotice: AI_GUARDRAIL_NOTICE,
  };
}

aiRouter.get(
  '/usage',
  asyncHandler(async (req, res) => {
    res.json(await usageSummary(orgContext(req).organizationId));
  }),
);

aiRouter.get(
  '/interviews/:id/suggestions',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    res.json({
      guardrailNotice: AI_GUARDRAIL_NOTICE,
      items: await listSuggestions(id),
    });
  }),
);

aiRouter.post(
  '/interviews/:id/suggestions',
  aiLimiter,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    const input = parseBody(aiSuggestionRequestSchema, req);

    try {
      const outcome = await requestSuggestion(id, input, actorOf(req));
      res.status(201).json({ available: true, guardrailNotice: AI_GUARDRAIL_NOTICE, ...outcome });
    } catch (err) {
      if (err instanceof CopilotUnavailable) {
        // 503, not 500: the feature is unconfigured or upstream is down, and the
        // client renders the reason verbatim rather than inventing a suggestion.
        res.status(503).json(unavailablePayload(err));
        return;
      }
      throw err;
    }
  }),
);

/**
 * Streaming variant. Sends Server-Sent Events:
 *   event: delta   -> incremental model text, so the interviewer sees progress
 *   event: result  -> the validated, persisted, structured suggestion
 *   event: error   -> a terminal failure with a human-readable reason
 *
 * The structured payload is only produced after the full response has been parsed
 * and guardrail-checked, so partial text is never persisted as a suggestion.
 */
aiRouter.post(
  '/interviews/:id/suggestions/stream',
  aiLimiter,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    const input = parseBody(aiSuggestionRequestSchema, req);

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const abort = new AbortController();
    req.on('close', () => abort.abort(new Error('client disconnected')));

    try {
      const provider = resolveProvider();
      if (!provider) {
        throw new CopilotUnavailable(
          'not_configured',
          'No LLM provider is configured. Set AI_PROVIDER and AI_API_KEY to enable the copilot.',
        );
      }
      await assertWithinBudget(orgContext(req).organizationId);

      const { ctx, questionId, executionJobId } = await buildContext(id, input);
      send('start', { kind: input.kind, provider: provider.name, model: provider.model });

      const started = Date.now();
      const iterator = provider.stream({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(input.kind, ctx) }],
        maxOutputTokens: config().AI_MAX_OUTPUT_TOKENS,
        signal: abort.signal,
      });

      let final: Awaited<ReturnType<typeof iterator.next>>;
      for (;;) {
        final = await iterator.next();
        if (final.done) break;
        send('delta', { delta: final.value.delta });
      }

      const response = final.value;
      const outcome = await finalise({
        interviewId: id,
        questionId,
        executionJobId: input.executionJobId ?? executionJobId,
        actor: actorOf(req),
        request: input,
        provider: provider.name,
        model: response.model,
        text: response.text,
        usage: { ...response.usage, latencyMs: Date.now() - started },
      });

      send('result', { available: true, guardrailNotice: AI_GUARDRAIL_NOTICE, ...outcome });
    } catch (err) {
      if (err instanceof CopilotUnavailable) {
        send('error', unavailablePayload(err));
      } else {
        const detail = err instanceof LlmError ? err.message : 'The copilot request failed.';
        logger.error({ err, interviewId: id }, 'copilot stream failed');
        send('error', {
          available: false,
          reason: 'provider_error',
          message: detail,
          guardrailNotice: AI_GUARDRAIL_NOTICE,
        });
      }
    } finally {
      res.write('event: done\ndata: {}\n\n');
      res.end();
    }
  }),
);
