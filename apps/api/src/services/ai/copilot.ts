import { Prisma } from '@prisma/client';
import {
  AI_FORBIDDEN_PATTERNS,
  AI_SUGGESTION_KIND_LABELS,
  normaliseOutput,
  type AiSuggestionKind,
  type AiSuggestionPayload,
  type AiSuggestionRequest,
} from '@hirefo/shared';
import { config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db/prisma.js';
import { recordAudit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { ensureDocument } from '../documents.js';
import { resolveProvider } from './index.js';
import { buildUserPrompt, SYSTEM_PROMPT, type CopilotContext } from './prompts.js';
import { LlmError, type LlmProvider, type LlmResponse } from './provider.js';

export interface CopilotActor {
  userId: string;
  organizationId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface CopilotOutcome {
  id: string;
  kind: AiSuggestionKind;
  payload: AiSuggestionPayload;
  provider: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; costUsd: number; latencyMs: number };
  degraded: boolean;
  degradedReason: string | null;
  createdAt: Date;
}

/** Reason the copilot could not produce model output. Surfaced verbatim in the UI. */
export class CopilotUnavailable extends Error {
  constructor(
    readonly reason: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'CopilotUnavailable';
  }
}

export function costUsd(promptTokens: number, completionTokens: number): number {
  const cfg = config();
  const input = (promptTokens / 1_000_000) * cfg.AI_PRICE_INPUT_PER_MTOK;
  const output = (completionTokens / 1_000_000) * cfg.AI_PRICE_OUTPUT_PER_MTOK;
  return Number((input + output).toFixed(6));
}

/** Today's spend for an organization, in USD. */
export async function dailySpendUsd(organizationId: string): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.aiSuggestion.aggregate({
    where: { interview: { organizationId }, createdAt: { gte: since } },
    _sum: { costUsd: true },
  });
  const sum = rows._sum.costUsd;
  return sum ? Number(sum.toString()) : 0;
}

export async function assertWithinBudget(organizationId: string): Promise<void> {
  const limit = config().AI_DAILY_BUDGET_USD;
  if (limit <= 0) return;
  const spent = await dailySpendUsd(organizationId);
  if (spent >= limit) {
    throw new CopilotUnavailable(
      'budget_exhausted',
      `This organization has reached its configured copilot budget for today ($${spent.toFixed(
        4,
      )} of $${limit.toFixed(2)}). Raise AI_DAILY_BUDGET_USD to continue.`,
    );
  }
}

/** Collects everything the copilot is allowed to see about the live session. */
export async function buildContext(
  interviewId: string,
  request: AiSuggestionRequest,
): Promise<{ ctx: CopilotContext; questionId: string | null; executionJobId: string | null }> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      questions: {
        orderBy: { orderIndex: 'asc' },
        include: { question: true },
      },
      notes: {
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { body: true },
      },
      _count: { select: { submissions: true } },
    },
  });
  if (!interview) throw notFound('Interview not found.');

  const questionId = request.questionId ?? interview.activeQuestionId ?? interview.questions[0]?.questionId ?? null;
  const link = questionId ? interview.questions.find((q) => q.questionId === questionId) : undefined;

  let code = request.code ?? '';
  if (!request.code) {
    const doc = await ensureDocument(interviewId, questionId);
    code = doc.content;
  }

  const starter =
    link && link.question.starterCode && typeof link.question.starterCode === 'object'
      ? ((link.question.starterCode as Record<string, unknown>)[interview.language] as string | undefined)
      : undefined;
  const codeIsEmpty =
    normaliseOutput(code).length === 0 ||
    (typeof starter === 'string' && normaliseOutput(code) === normaliseOutput(starter));

  // Latest finished execution for this question, or the one explicitly referenced.
  const job = await prisma.executionJob.findFirst({
    where: request.executionJobId
      ? { id: request.executionJobId, submission: { interviewId } }
      : {
          submission: { interviewId, ...(questionId ? { questionId } : {}) },
          status: { in: ['SUCCEEDED', 'FAILED', 'TIMEOUT', 'ERROR'] },
        },
    orderBy: { enqueuedAt: 'desc' },
    include: {
      result: true,
      testResults: { include: { testCase: true } },
    },
  });

  const elapsedMinutes = interview.startedAt
    ? Math.round((Date.now() - interview.startedAt.getTime()) / 60_000)
    : null;

  const ctx: CopilotContext = {
    interviewTitle: interview.title,
    interviewStatus: interview.status,
    language: interview.language,
    elapsedMinutes,
    durationMinutes: interview.durationMinutes,
    question: link
      ? {
          title: link.question.title,
          difficulty: link.question.difficulty,
          description: link.question.description,
          expectedComplexity: link.question.expectedComplexity,
          categories: link.question.categories,
          examples: Array.isArray(link.question.examples)
            ? (link.question.examples as { input: string; output: string; explanation?: string }[])
            : [],
          hints: link.question.hints,
          evaluationCriteria: link.question.evaluationCriteria,
        }
      : null,
    code,
    codeIsEmpty,
    execution: job
      ? {
          status: job.status,
          passedCount: job.result?.passedCount ?? 0,
          totalCount: job.result?.totalCount ?? 0,
          compileOutput: job.result?.compileOutput ?? null,
          stderr: job.result?.stderr ?? '',
          // The copilot is interviewer-facing, so hidden cases are included.
          cases: job.testResults.map((tr) => ({
            name: tr.testCase.name,
            visibility: tr.testCase.visibility,
            passed: tr.passed,
            timedOut: tr.timedOut,
            input: tr.testCase.input,
            expectedOutput: tr.testCase.expectedOutput,
            actualOutput: tr.actualOutput,
          })),
        }
      : null,
    recentSubmissionCount: interview._count.submissions,
    interviewerNotes: interview.notes.map((n) => n.body),
    ...(request.instruction ? { instruction: request.instruction } : {}),
  };

  return { ctx, questionId, executionJobId: job?.id ?? null };
}

/** Pulls the first balanced JSON object out of a model response. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const start = trimmed.indexOf('{');
  if (start === -1) throw new Error('no JSON object in response');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(trimmed.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced JSON object in response');
}

const asStringArray = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim())
        .slice(0, max)
    : [];

/**
 * Normalises the model output into AiSuggestionPayload and strips anything that
 * breaks the guardrails. A stripped item is replaced by an explicit note, so the
 * interviewer can see that something was withheld rather than silently losing it.
 */
export function validatePayload(
  kind: AiSuggestionKind,
  raw: unknown,
): { payload: AiSuggestionPayload; violations: string[] } {
  const violations: string[] = [];
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const clean = (value: string, where: string): string | null => {
    for (const pattern of AI_FORBIDDEN_PATTERNS) {
      if (pattern.test(value)) {
        violations.push(`${where}: removed text matching ${pattern.source}`);
        return null;
      }
    }
    return value;
  };

  const cleanList = (items: string[], where: string): string[] =>
    items.map((i) => clean(i, where)).filter((i): i is string => i !== null);

  const headlineRaw =
    typeof obj['headline'] === 'string' && obj['headline'].trim()
      ? obj['headline'].trim()
      : AI_SUGGESTION_KIND_LABELS[kind];
  const headline = clean(headlineRaw, 'headline') ?? AI_SUGGESTION_KIND_LABELS[kind];

  const suggestionsRaw = Array.isArray(obj['suggestions']) ? obj['suggestions'] : [];
  const suggestions = suggestionsRaw
    .slice(0, 8)
    .map((item) => {
      const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const title = typeof s['title'] === 'string' ? s['title'].trim() : '';
      const detail = typeof s['detail'] === 'string' ? s['detail'].trim() : '';
      if (!title && !detail) return null;
      const safeTitle = clean(title || 'Suggestion', 'suggestion.title');
      const safeDetail = clean(detail, 'suggestion.detail');
      if (safeTitle === null || safeDetail === null) return null;
      const rationale =
        typeof s['rationale'] === 'string' && s['rationale'].trim()
          ? clean(s['rationale'].trim(), 'suggestion.rationale')
          : null;
      return {
        title: safeTitle,
        detail: safeDetail,
        ...(rationale ? { rationale } : {}),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const limitationsRaw =
    typeof obj['limitations'] === 'string' && obj['limitations'].trim()
      ? obj['limitations'].trim()
      : undefined;

  const payload: AiSuggestionPayload = {
    kind,
    headline,
    observations: cleanList(asStringArray(obj['observations'], 8), 'observations'),
    assumptions: cleanList(asStringArray(obj['assumptions'], 8), 'assumptions'),
    suggestions,
    ...(limitationsRaw ? { limitations: clean(limitationsRaw, 'limitations') ?? undefined } : {}),
  };

  if (violations.length) {
    payload.limitations = [
      payload.limitations,
      `${violations.length} item(s) were withheld because they broke the copilot's guardrails (no hiring verdicts, no judgements about the person).`,
    ]
      .filter(Boolean)
      .join(' ');
  }

  return { payload, violations };
}

async function persist(params: {
  interviewId: string;
  questionId: string | null;
  executionJobId: string | null;
  actor: CopilotActor;
  kind: AiSuggestionKind;
  instruction?: string;
  provider: string;
  model: string;
  payload: AiSuggestionPayload;
  rawResponse: string | null;
  usage: { promptTokens: number; completionTokens: number; latencyMs: number };
  degraded: boolean;
  degradedReason: string | null;
}): Promise<CopilotOutcome> {
  const cost = costUsd(params.usage.promptTokens, params.usage.completionTokens);
  const row = await prisma.aiSuggestion.create({
    data: {
      interviewId: params.interviewId,
      questionId: params.questionId,
      executionJobId: params.executionJobId,
      requestedById: params.actor.userId,
      kind: params.kind,
      instruction: params.instruction ?? null,
      provider: params.provider,
      model: params.model,
      payload: params.payload as unknown as Prisma.InputJsonValue,
      rawResponse: params.rawResponse,
      promptTokens: params.usage.promptTokens,
      completionTokens: params.usage.completionTokens,
      costUsd: new Prisma.Decimal(cost),
      latencyMs: params.usage.latencyMs,
      degraded: params.degraded,
      degradedReason: params.degradedReason,
    },
  });

  await recordAudit({
    action: 'ai.suggestion',
    organizationId: params.actor.organizationId,
    actorId: params.actor.userId,
    targetType: 'ai_suggestion',
    targetId: row.id,
    metadata: {
      kind: params.kind,
      interviewId: params.interviewId,
      provider: params.provider,
      model: params.model,
      promptTokens: params.usage.promptTokens,
      completionTokens: params.usage.completionTokens,
      costUsd: cost,
      degraded: params.degraded,
    },
    ip: params.actor.ip,
    userAgent: params.actor.userAgent,
  });

  return {
    id: row.id,
    kind: params.kind,
    payload: params.payload,
    provider: params.provider,
    model: params.model,
    usage: { ...params.usage, costUsd: cost },
    degraded: params.degraded,
    degradedReason: params.degradedReason,
    createdAt: row.createdAt,
  };
}

function requireProvider(): LlmProvider {
  const provider = resolveProvider();
  if (!provider) {
    throw new CopilotUnavailable(
      'not_configured',
      'No LLM provider is configured. Set AI_PROVIDER and AI_API_KEY in the environment to enable the copilot. ' +
        'Until then the copilot returns this notice instead of model output — nothing is generated locally.',
    );
  }
  return provider;
}

/** Non-streaming copilot request. */
export async function requestSuggestion(
  interviewId: string,
  request: AiSuggestionRequest,
  actor: CopilotActor,
): Promise<CopilotOutcome> {
  const provider = requireProvider();
  await assertWithinBudget(actor.organizationId);

  const { ctx, questionId, executionJobId } = await buildContext(interviewId, request);
  const started = Date.now();

  let response: LlmResponse;
  try {
    response = await provider.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(request.kind, ctx) }],
      maxOutputTokens: config().AI_MAX_OUTPUT_TOKENS,
    });
  } catch (err) {
    const detail = err instanceof LlmError ? err.message : String(err);
    logger.error({ err, interviewId, kind: request.kind }, 'copilot provider call failed');
    throw new CopilotUnavailable('provider_error', `The model provider could not be reached: ${detail}`);
  }

  const latencyMs = Date.now() - started;
  return finalise({
    interviewId,
    questionId,
    executionJobId: request.executionJobId ?? executionJobId,
    actor,
    request,
    provider: provider.name,
    model: response.model,
    text: response.text,
    usage: { ...response.usage, latencyMs },
  });
}

/** Shared tail of both the streaming and non-streaming paths. */
export async function finalise(params: {
  interviewId: string;
  questionId: string | null;
  executionJobId: string | null;
  actor: CopilotActor;
  request: AiSuggestionRequest;
  provider: string;
  model: string;
  text: string;
  usage: { promptTokens: number; completionTokens: number; latencyMs: number };
}): Promise<CopilotOutcome> {
  let parsed: unknown;
  let degraded = false;
  let degradedReason: string | null = null;

  try {
    parsed = extractJsonObject(params.text);
  } catch (err) {
    // The model ignored the format contract. Keep the text rather than discard it,
    // but mark the result degraded so the UI can say so plainly.
    degraded = true;
    degradedReason = `The model did not return the expected JSON structure (${
      err instanceof Error ? err.message : 'parse error'
    }). The raw reply is shown below.`;
    parsed = {
      headline: AI_SUGGESTION_KIND_LABELS[params.request.kind],
      observations: [],
      assumptions: [],
      suggestions: [{ title: 'Unstructured model reply', detail: params.text.trim().slice(0, 4000) }],
    };
  }

  const { payload, violations } = validatePayload(params.request.kind, parsed);
  if (violations.length) {
    logger.warn(
      { interviewId: params.interviewId, kind: params.request.kind, violations },
      'copilot output violated guardrails and was filtered',
    );
  }

  return persist({
    interviewId: params.interviewId,
    questionId: params.questionId,
    executionJobId: params.executionJobId,
    actor: params.actor,
    kind: params.request.kind,
    ...(params.request.instruction ? { instruction: params.request.instruction } : {}),
    provider: params.provider,
    model: params.model,
    payload,
    rawResponse: params.text.slice(0, 20_000),
    usage: params.usage,
    degraded,
    degradedReason,
  });
}

export async function listSuggestions(interviewId: string, limit = 50) {
  const rows = await prisma.aiSuggestion.findMany({
    where: { interviewId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      requestedBy: { select: { id: true, name: true } },
      question: { select: { id: true, title: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: r.payload as unknown as AiSuggestionPayload,
    provider: r.provider,
    model: r.model,
    instruction: r.instruction,
    requestedBy: r.requestedBy,
    question: r.question,
    usage: {
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      costUsd: Number(r.costUsd.toString()),
      latencyMs: r.latencyMs,
    },
    degraded: r.degraded,
    degradedReason: r.degradedReason,
    createdAt: r.createdAt,
  }));
}

/** Token and cost roll-up for the organization. */
export async function usageSummary(organizationId: string) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const [allTime, today, byKind] = await Promise.all([
    prisma.aiSuggestion.aggregate({
      where: { interview: { organizationId } },
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
      _count: true,
    }),
    prisma.aiSuggestion.aggregate({
      where: { interview: { organizationId }, createdAt: { gte: since } },
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
      _count: true,
    }),
    prisma.aiSuggestion.groupBy({
      by: ['kind'],
      where: { interview: { organizationId } },
      _count: { _all: true },
      _sum: { costUsd: true },
    }),
  ]);

  const shape = (agg: typeof allTime) => ({
    requests: agg._count,
    promptTokens: agg._sum.promptTokens ?? 0,
    completionTokens: agg._sum.completionTokens ?? 0,
    costUsd: agg._sum.costUsd ? Number(agg._sum.costUsd.toString()) : 0,
  });

  return {
    provider: config().AI_PROVIDER,
    model: config().AI_MODEL,
    enabled: config().aiEnabled,
    dailyBudgetUsd: config().AI_DAILY_BUDGET_USD,
    pricing: {
      inputPerMTok: config().AI_PRICE_INPUT_PER_MTOK,
      outputPerMTok: config().AI_PRICE_OUTPUT_PER_MTOK,
      configured:
        config().AI_PRICE_INPUT_PER_MTOK > 0 || config().AI_PRICE_OUTPUT_PER_MTOK > 0,
    },
    allTime: shape(allTime),
    today: shape(today),
    byKind: byKind.map((k) => ({
      kind: k.kind,
      requests: k._count._all,
      costUsd: k._sum.costUsd ? Number(k._sum.costUsd.toString()) : 0,
    })),
  };
}
