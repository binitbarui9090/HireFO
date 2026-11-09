import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  LANGUAGES,
  starterCodeFor,
  type createInterviewSchema,
  type LanguageId,
  type listInterviewsSchema,
  type updateInterviewSchema,
} from '@hirefo/shared';
import { prisma, type Tx } from '../db/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { Actor } from './questions.js';

type CreateInput = z.infer<typeof createInterviewSchema>;
type UpdateInput = z.infer<typeof updateInterviewSchema>;
type ListInput = z.infer<typeof listInterviewsSchema>;

/** Status transitions the API will accept. Anything else is rejected. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SCHEDULED', 'IN_PROGRESS', 'CANCELLED'],
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED', 'DRAFT'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Verifies every id belongs to the caller's organization before it is linked. */
async function assertOrgQuestions(ids: string[], organizationId: string, tx: Tx): Promise<void> {
  if (ids.length === 0) return;
  const found = await tx.question.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true },
  });
  if (found.length !== new Set(ids).size) {
    throw badRequest('One or more questions do not exist in this organization.');
  }
}

async function assertOrgUsers(ids: string[], organizationId: string, tx: Tx): Promise<void> {
  if (ids.length === 0) return;
  const found = await tx.membership.findMany({
    where: { userId: { in: ids }, organizationId, status: 'ACTIVE' },
    select: { userId: true },
  });
  if (found.length !== new Set(ids).size) {
    throw badRequest('One or more users are not active members of this organization.');
  }
}

export async function createInterview(input: CreateInput, actor: Actor) {
  if (!LANGUAGES[input.language as LanguageId]) {
    throw badRequest(`Unknown language "${input.language}".`);
  }

  const interview = await prisma.$transaction(async (tx) => {
    await assertOrgQuestions(input.questionIds, actor.organizationId, tx);
    const staffIds = [...new Set([...input.interviewerIds, actor.userId])];
    await assertOrgUsers(staffIds, actor.organizationId, tx);
    if (input.candidateUserId) {
      await assertOrgUsers([input.candidateUserId], actor.organizationId, tx);
    }

    const created = await tx.interview.create({
      data: {
        organizationId: actor.organizationId,
        createdById: actor.userId,
        title: input.title,
        language: input.language,
        difficulty: input.difficulty ?? null,
        scheduledAt: input.scheduledAt ?? null,
        durationMinutes: input.durationMinutes,
        candidateEmail: input.candidateEmail ?? null,
        privateNotes: input.privateNotes ?? null,
        status: input.scheduledAt ? 'SCHEDULED' : 'DRAFT',
        questions: {
          create: input.questionIds.map((questionId, index) => ({ questionId, orderIndex: index })),
        },
        participants: {
          create: [
            ...staffIds.map((userId) => ({ userId, role: 'INTERVIEWER' as const })),
            ...(input.candidateUserId
              ? [{ userId: input.candidateUserId, role: 'CANDIDATE' as const }]
              : []),
          ],
        },
      },
    });

    if (input.questionIds.length) {
      await tx.interview.update({
        where: { id: created.id },
        data: { activeQuestionId: input.questionIds[0] },
      });
    }

    await recordAudit(
      {
        action: 'interview.create',
        organizationId: actor.organizationId,
        actorId: actor.userId,
        targetType: 'interview',
        targetId: created.id,
        metadata: {
          title: created.title,
          language: created.language,
          questions: input.questionIds.length,
          interviewers: staffIds.length,
        },
        ip: actor.ip,
        userAgent: actor.userAgent,
      },
      tx,
    );
    return created;
  });

  return getInterview(interview.id, actor.organizationId, true);
}

export async function listInterviews(filters: ListInput, actor: Actor, restrictToParticipant: boolean) {
  const where: Prisma.InterviewWhereInput = {
    organizationId: actor.organizationId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.search ? { title: { contains: filters.search, mode: 'insensitive' } } : {}),
    // Candidates may only ever see interviews they take part in.
    ...(restrictToParticipant || filters.mine
      ? { participants: { some: { userId: actor.userId } } }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.interview.count({ where }),
    prisma.interview.findMany({
      where,
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: {
        createdBy: { select: { id: true, name: true } },
        participants: {
          include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } },
        },
        _count: { select: { questions: true, submissions: true } },
      },
    }),
  ]);

  return {
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    items: rows.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      language: i.language,
      difficulty: i.difficulty,
      scheduledAt: i.scheduledAt,
      durationMinutes: i.durationMinutes,
      startedAt: i.startedAt,
      endedAt: i.endedAt,
      createdAt: i.createdAt,
      createdBy: i.createdBy,
      questionCount: i._count.questions,
      submissionCount: i._count.submissions,
      participants: i.participants.map((p) => ({
        userId: p.userId,
        role: p.role,
        name: p.user.name,
        email: p.user.email,
        avatarColor: p.user.avatarColor,
        joinedAt: p.joinedAt,
      })),
    })),
  };
}

/** `isStaff` gates private interviewer notes and hidden question material. */
export async function getInterview(id: string, organizationId: string, isStaff: boolean) {
  const interview = await prisma.interview.findFirst({
    where: { id, organizationId },
    include: {
      createdBy: { select: { id: true, name: true } },
      participants: {
        include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } },
      },
      questions: {
        orderBy: { orderIndex: 'asc' },
        include: {
          question: {
            select: {
              id: true,
              title: true,
              difficulty: true,
              categories: true,
              languages: true,
              expectedComplexity: true,
              description: true,
              examples: true,
              starterCode: true,
              hints: true,
              evaluationCriteria: true,
              _count: { select: { testCases: true } },
            },
          },
        },
      },
      invitations: {
        where: { revokedAt: null },
        select: { id: true, email: true, role: true, expiresAt: true, acceptedAt: true },
      },
    },
  });
  if (!interview) throw notFound('Interview not found.');

  return {
    id: interview.id,
    organizationId: interview.organizationId,
    title: interview.title,
    status: interview.status,
    language: interview.language as LanguageId,
    difficulty: interview.difficulty,
    scheduledAt: interview.scheduledAt,
    durationMinutes: interview.durationMinutes,
    startedAt: interview.startedAt,
    endedAt: interview.endedAt,
    activeQuestionId: interview.activeQuestionId,
    candidateEmail: interview.candidateEmail,
    cancelledReason: interview.cancelledReason,
    createdAt: interview.createdAt,
    createdBy: interview.createdBy,
    privateNotes: isStaff ? interview.privateNotes : null,
    invitations: isStaff ? interview.invitations : [],
    participants: interview.participants.map((p) => ({
      userId: p.userId,
      role: p.role,
      name: p.user.name,
      email: p.user.email,
      avatarColor: p.user.avatarColor,
      joinedAt: p.joinedAt,
      lastSeenAt: p.lastSeenAt,
    })),
    questions: interview.questions.map((iq) => ({
      questionId: iq.questionId,
      orderIndex: iq.orderIndex,
      title: iq.question.title,
      difficulty: iq.question.difficulty,
      categories: iq.question.categories,
      languages: iq.question.languages,
      description: iq.question.description,
      examples: iq.question.examples,
      starterCode: iq.question.starterCode,
      expectedComplexity: iq.question.expectedComplexity,
      testCaseCount: iq.question._count.testCases,
      // Hints and criteria are interviewer material.
      hints: isStaff ? iq.question.hints : [],
      evaluationCriteria: isStaff ? iq.question.evaluationCriteria : [],
    })),
  };
}

export async function updateInterview(id: string, input: UpdateInput, actor: Actor) {
  const existing = await prisma.interview.findFirst({
    where: { id, organizationId: actor.organizationId },
    select: { id: true, status: true },
  });
  if (!existing) throw notFound('Interview not found.');

  if (input.status && !canTransition(existing.status, input.status)) {
    throw conflict(`Cannot move an interview from ${existing.status} to ${input.status}.`);
  }

  await prisma.$transaction(async (tx) => {
    if (input.questionIds !== undefined) {
      await assertOrgQuestions(input.questionIds, actor.organizationId, tx);
      await tx.interviewQuestion.deleteMany({ where: { interviewId: id } });
      await tx.interviewQuestion.createMany({
        data: input.questionIds.map((questionId, index) => ({
          interviewId: id,
          questionId,
          orderIndex: index,
        })),
      });
    }

    if (input.interviewerIds !== undefined) {
      await assertOrgUsers(input.interviewerIds, actor.organizationId, tx);
      await tx.interviewParticipant.deleteMany({ where: { interviewId: id, role: 'INTERVIEWER' } });
      await tx.interviewParticipant.createMany({
        data: input.interviewerIds.map((userId) => ({ interviewId: id, userId, role: 'INTERVIEWER' as const })),
        skipDuplicates: true,
      });
    }

    if (input.candidateUserId !== undefined) {
      await assertOrgUsers([input.candidateUserId], actor.organizationId, tx);
      await tx.interviewParticipant.deleteMany({ where: { interviewId: id, role: 'CANDIDATE' } });
      await tx.interviewParticipant.create({
        data: { interviewId: id, userId: input.candidateUserId, role: 'CANDIDATE' },
      });
    }

    const statusTimestamps: Prisma.InterviewUpdateInput = {};
    if (input.status === 'IN_PROGRESS') statusTimestamps.startedAt = new Date();
    if (input.status === 'COMPLETED' || input.status === 'CANCELLED') {
      statusTimestamps.endedAt = new Date();
    }

    await tx.interview.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.language !== undefined ? { language: input.language } : {}),
        ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
        ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt } : {}),
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.candidateEmail !== undefined ? { candidateEmail: input.candidateEmail } : {}),
        ...(input.privateNotes !== undefined ? { privateNotes: input.privateNotes } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...statusTimestamps,
      },
    });

    const action =
      input.status === 'CANCELLED'
        ? 'interview.cancel'
        : input.status === 'IN_PROGRESS'
          ? 'interview.start'
          : input.status === 'COMPLETED'
            ? 'interview.complete'
            : 'interview.update';

    await recordAudit(
      {
        action,
        organizationId: actor.organizationId,
        actorId: actor.userId,
        targetType: 'interview',
        targetId: id,
        metadata: { fields: Object.keys(input), from: existing.status, to: input.status ?? existing.status },
        ip: actor.ip,
        userAgent: actor.userAgent,
      },
      tx,
    );
  });

  return getInterview(id, actor.organizationId, true);
}

/** Records that a participant is present. Keeps the first joinedAt, refreshes lastSeenAt. */
export async function markParticipantJoined(interviewId: string, userId: string): Promise<void> {
  const now = new Date();
  await prisma.interviewParticipant.upsert({
    where: { interviewId_userId: { interviewId, userId } },
    create: { interviewId, userId, role: 'OBSERVER', joinedAt: now, lastSeenAt: now },
    update: { lastSeenAt: now },
  });
  // Only set joinedAt the first time, so the timeline keeps the original join.
  await prisma.interviewParticipant.updateMany({
    where: { interviewId, userId, joinedAt: null },
    data: { joinedAt: now },
  });
}

/** Default editor content for an interview question + language. */
export function defaultDocumentContent(
  starterCode: unknown,
  language: LanguageId,
): string {
  if (starterCode && typeof starterCode === 'object' && !Array.isArray(starterCode)) {
    const value = (starterCode as Record<string, unknown>)[language];
    if (typeof value === 'string' && value.trim().length) return value;
  }
  return starterCodeFor(language);
}
