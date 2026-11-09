import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { createRubricSchema, RubricCriterion, saveEvaluationSchema } from '@hirefo/shared';
import { prisma } from '../db/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { Actor } from './questions.js';

type SaveInput = z.infer<typeof saveEvaluationSchema>;
type RubricInput = z.infer<typeof createRubricSchema>;

export async function listRubrics(organizationId: string) {
  return prisma.evaluationRubric.findMany({
    where: { organizationId },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
}

export async function createRubric(input: RubricInput, actor: Actor) {
  const keys = new Set(input.criteria.map((c) => c.key));
  if (keys.size !== input.criteria.length) {
    throw badRequest('Rubric criterion keys must be unique.');
  }

  const rubric = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.evaluationRubric.updateMany({
        where: { organizationId: actor.organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const created = await tx.evaluationRubric.create({
      data: {
        organizationId: actor.organizationId,
        name: input.name,
        description: input.description ?? null,
        criteria: input.criteria as unknown as Prisma.InputJsonValue,
        isDefault: input.isDefault,
      },
    });
    await recordAudit(
      {
        action: 'rubric.create',
        organizationId: actor.organizationId,
        actorId: actor.userId,
        targetType: 'rubric',
        targetId: created.id,
        metadata: { name: created.name, criteria: input.criteria.length },
        ip: actor.ip,
        userAgent: actor.userAgent,
      },
      tx,
    );
    return created;
  });

  return rubric;
}

/**
 * One evaluation per (interview, interviewer). Saving is idempotent; submitting
 * stamps submittedAt and from then on the record is read-only, so a signed-off
 * evaluation cannot be quietly rewritten.
 */
export async function saveEvaluation(interviewId: string, input: SaveInput, actor: Actor) {
  const existing = await prisma.evaluation.findUnique({
    where: { interviewId_authorId: { interviewId, authorId: actor.userId } },
  });
  if (existing?.submittedAt) {
    throw conflict('This evaluation has already been submitted and can no longer be edited.');
  }

  let rubricId: string | null = input.rubricId ?? existing?.rubricId ?? null;
  let criteria: RubricCriterion[] = [];
  if (rubricId) {
    const rubric = await prisma.evaluationRubric.findFirst({
      where: { id: rubricId, organizationId: actor.organizationId },
    });
    if (!rubric) throw notFound('Rubric not found in this organization.');
    criteria = rubric.criteria as unknown as RubricCriterion[];
  } else {
    const fallback = await prisma.evaluationRubric.findFirst({
      where: { organizationId: actor.organizationId, isDefault: true },
    });
    if (fallback) {
      rubricId = fallback.id;
      criteria = fallback.criteria as unknown as RubricCriterion[];
    }
  }

  // Scores must reference known criteria and stay inside their maxScore.
  const byKey = new Map(criteria.map((c) => [c.key, c]));
  for (const [key, value] of Object.entries(input.scores)) {
    const criterion = byKey.get(key);
    if (!criterion) throw badRequest(`Unknown rubric criterion "${key}".`);
    if (value > criterion.maxScore) {
      throw badRequest(`Score for "${key}" exceeds its maximum of ${criterion.maxScore}.`);
    }
  }

  const data = {
    rubricId,
    scores: input.scores as unknown as Prisma.InputJsonValue,
    strengths: input.strengths,
    concerns: input.concerns,
    communicationObservations: input.communicationObservations,
    problemSolvingObservations: input.problemSolvingObservations,
    summary: input.summary,
    recommendation: input.recommendation ?? null,
    submittedAt: input.submit ? new Date() : null,
  };

  const evaluation = await prisma.evaluation.upsert({
    where: { interviewId_authorId: { interviewId, authorId: actor.userId } },
    create: { interviewId, authorId: actor.userId, ...data },
    update: data,
    include: { author: { select: { id: true, name: true } }, rubric: true },
  });

  await recordAudit({
    action: input.submit ? 'evaluation.submit' : 'evaluation.save',
    organizationId: actor.organizationId,
    actorId: actor.userId,
    targetType: 'evaluation',
    targetId: evaluation.id,
    metadata: {
      interviewId,
      recommendation: evaluation.recommendation,
      scoredCriteria: Object.keys(input.scores).length,
    },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return evaluation;
}

export async function listEvaluations(interviewId: string) {
  return prisma.evaluation.findMany({
    where: { interviewId },
    orderBy: { updatedAt: 'desc' },
    include: {
      author: { select: { id: true, name: true, avatarColor: true } },
      rubric: { select: { id: true, name: true, criteria: true } },
    },
  });
}
