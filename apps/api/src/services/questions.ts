import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type {
  createQuestionSchema,
  listQuestionsSchema,
  updateQuestionSchema,
} from '@hirefo/shared';
import { prisma } from '../db/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { slugify } from '../lib/ids.js';

type CreateInput = z.infer<typeof createQuestionSchema>;
type UpdateInput = z.infer<typeof updateQuestionSchema>;
type ListInput = z.infer<typeof listQuestionsSchema>;

export interface Actor {
  userId: string;
  organizationId: string;
  ip?: string | null;
  userAgent?: string | null;
}

async function uniqueSlug(organizationId: string, title: string, excludeId?: string): Promise<string> {
  const base = slugify(title);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await prisma.question.findFirst({
      where: { organizationId, slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function listQuestions(filters: ListInput, organizationId: string) {
  const where: Prisma.QuestionWhereInput = {
    organizationId,
    ...(filters.includeArchived ? {} : { isArchived: false }),
    ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
    ...(filters.category ? { categories: { has: filters.category } } : {}),
    ...(filters.language ? { languages: { has: filters.language } } : {}),
    ...(filters.search
      ? {
          OR: [
            { title: { contains: filters.search, mode: 'insensitive' } },
            { description: { contains: filters.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { testCases: true, interviewQuestions: true } },
      },
    }),
  ]);

  return {
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    items: rows.map((q) => ({
      id: q.id,
      title: q.title,
      slug: q.slug,
      difficulty: q.difficulty,
      categories: q.categories,
      languages: q.languages,
      expectedComplexity: q.expectedComplexity,
      isArchived: q.isArchived,
      createdBy: q.createdBy,
      updatedAt: q.updatedAt,
      testCaseCount: q._count.testCases,
      usedInInterviews: q._count.interviewQuestions,
    })),
  };
}

/** `includeHidden` gates hidden test cases; candidates never get them. */
export async function getQuestion(id: string, organizationId: string, includeHidden: boolean) {
  const q = await prisma.question.findFirst({
    where: { id, organizationId },
    include: {
      createdBy: { select: { id: true, name: true } },
      testCases: { orderBy: { orderIndex: 'asc' } },
    },
  });
  if (!q) throw notFound('Question not found.');

  return {
    id: q.id,
    title: q.title,
    slug: q.slug,
    description: q.description,
    difficulty: q.difficulty,
    categories: q.categories,
    languages: q.languages,
    expectedComplexity: q.expectedComplexity,
    hints: includeHidden ? q.hints : [],
    evaluationCriteria: includeHidden ? q.evaluationCriteria : [],
    examples: q.examples,
    starterCode: q.starterCode,
    isArchived: q.isArchived,
    createdBy: q.createdBy,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    hiddenTestCaseCount: q.testCases.filter((t) => t.visibility === 'HIDDEN').length,
    testCases: q.testCases
      .filter((t) => includeHidden || t.visibility === 'PUBLIC')
      .map((t) => ({
        id: t.id,
        name: t.name,
        input: t.input,
        expectedOutput: t.expectedOutput,
        visibility: t.visibility,
        weight: t.weight,
        timeoutMs: t.timeoutMs,
        explanation: t.explanation,
        orderIndex: t.orderIndex,
      })),
  };
}

export async function createQuestion(input: CreateInput, actor: Actor) {
  const slug = await uniqueSlug(actor.organizationId, input.title);

  const question = await prisma.$transaction(async (tx) => {
    const created = await tx.question.create({
      data: {
        organizationId: actor.organizationId,
        createdById: actor.userId,
        title: input.title,
        slug,
        description: input.description,
        difficulty: input.difficulty,
        categories: input.categories,
        languages: input.languages,
        expectedComplexity: input.expectedComplexity ?? null,
        hints: input.hints,
        evaluationCriteria: input.evaluationCriteria,
        examples: input.examples as object,
        starterCode: input.starterCode as object,
        testCases: {
          create: input.testCases.map((tc, index) => ({
            name: tc.name,
            input: tc.input,
            expectedOutput: tc.expectedOutput,
            visibility: tc.visibility,
            weight: tc.weight,
            timeoutMs: tc.timeoutMs,
            explanation: tc.explanation ?? null,
            orderIndex: index,
          })),
        },
      },
    });
    await recordAudit(
      {
        action: 'question.create',
        organizationId: actor.organizationId,
        actorId: actor.userId,
        targetType: 'question',
        targetId: created.id,
        metadata: { title: created.title, testCases: input.testCases.length },
        ip: actor.ip,
        userAgent: actor.userAgent,
      },
      tx,
    );
    return created;
  });

  return getQuestion(question.id, actor.organizationId, true);
}

export async function updateQuestion(id: string, input: UpdateInput, actor: Actor) {
  const existing = await prisma.question.findFirst({
    where: { id, organizationId: actor.organizationId },
    select: { id: true, title: true },
  });
  if (!existing) throw notFound('Question not found.');

  const slug =
    input.title && input.title !== existing.title
      ? await uniqueSlug(actor.organizationId, input.title, id)
      : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.question.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(slug ? { slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
        ...(input.categories !== undefined ? { categories: input.categories } : {}),
        ...(input.languages !== undefined ? { languages: input.languages } : {}),
        ...(input.expectedComplexity !== undefined
          ? { expectedComplexity: input.expectedComplexity }
          : {}),
        ...(input.hints !== undefined ? { hints: input.hints } : {}),
        ...(input.evaluationCriteria !== undefined
          ? { evaluationCriteria: input.evaluationCriteria }
          : {}),
        ...(input.examples !== undefined ? { examples: input.examples as object } : {}),
        ...(input.starterCode !== undefined ? { starterCode: input.starterCode as object } : {}),
        ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
      },
    });

    // Test cases are replaced wholesale when supplied. Historical TestCaseResult
    // rows cascade-delete with their case, so replacement is only offered while
    // editing a question; results stay consistent either way.
    if (input.testCases !== undefined) {
      await tx.testCase.deleteMany({ where: { questionId: id } });
      await tx.testCase.createMany({
        data: input.testCases.map((tc, index) => ({
          questionId: id,
          name: tc.name,
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          visibility: tc.visibility,
          weight: tc.weight,
          timeoutMs: tc.timeoutMs,
          explanation: tc.explanation ?? null,
          orderIndex: index,
        })),
      });
    }

    await recordAudit(
      {
        action: input.isArchived ? 'question.archive' : 'question.update',
        organizationId: actor.organizationId,
        actorId: actor.userId,
        targetType: 'question',
        targetId: id,
        metadata: { fields: Object.keys(input) },
        ip: actor.ip,
        userAgent: actor.userAgent,
      },
      tx,
    );
  });

  return getQuestion(id, actor.organizationId, true);
}
