import { prisma } from '../db/prisma.js';
import { notFound } from '../lib/errors.js';

/**
 * Interview analytics.
 *
 * Everything here is a *count of recorded events*, not a measure of ability. The
 * API ships `disclaimer` alongside the numbers and the UI renders it next to them.
 * There is deliberately no composite "candidate score".
 */
export const ANALYTICS_DISCLAIMER =
  'These are counts of what happened in the session: runs, test outcomes and timings. ' +
  'They describe activity, not ability, and they are not a score. The written evaluation ' +
  'by the interviewer is the assessment of record.';

export async function interviewAnalytics(interviewId: string, organizationId: string) {
  const interview = await prisma.interview.findFirst({
    where: { id: interviewId, organizationId },
    include: {
      questions: { orderBy: { orderIndex: 'asc' }, include: { question: { select: { id: true, title: true, difficulty: true, _count: { select: { testCases: true } } } } } },
      participants: { include: { user: { select: { id: true, name: true, email: true } } } },
      submissions: {
        orderBy: { createdAt: 'asc' },
        include: {
          executionJob: { include: { result: true, testResults: true } },
        },
      },
      notes: { select: { id: true, isPrivate: true, createdAt: true, questionId: true } },
      evaluations: {
        include: { author: { select: { id: true, name: true } } },
      },
      aiSuggestions: { select: { id: true, kind: true, createdAt: true, costUsd: true } },
    },
  });
  if (!interview) throw notFound('Interview not found.');

  const runs = interview.submissions;
  const finished = runs.filter((s) => s.executionJob?.result);

  const perQuestion = interview.questions.map((iq) => {
    const questionRuns = runs.filter((s) => s.questionId === iq.questionId);
    const best = questionRuns
      .map((s) => s.executionJob?.result)
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .reduce<{ passed: number; total: number } | null>((acc, r) => {
        if (!acc || r.passedCount > acc.passed) return { passed: r.passedCount, total: r.totalCount };
        return acc;
      }, null);

    const submitRuns = questionRuns.filter((s) => s.kind === 'SUBMIT');
    const allPassed =
      best !== null && best.total > 0 && best.passed === best.total && submitRuns.length > 0;

    return {
      questionId: iq.questionId,
      title: iq.question.title,
      difficulty: iq.question.difficulty,
      totalTestCases: iq.question._count.testCases,
      runCount: questionRuns.length,
      submitCount: submitRuns.length,
      bestPassed: best?.passed ?? 0,
      bestTotal: best?.total ?? 0,
      /** "Completed" means every test case in a SUBMIT run passed. Nothing more. */
      completed: allPassed,
      firstRunAt: questionRuns[0]?.createdAt ?? null,
      lastRunAt: questionRuns[questionRuns.length - 1]?.createdAt ?? null,
    };
  });

  const statusCounts = runs.reduce<Record<string, number>>((acc, s) => {
    const status = s.executionJob?.status ?? 'QUEUED';
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});

  const durations = finished
    .map((s) => s.executionJob?.durationMs ?? 0)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);

  const totalTestsRun = finished.reduce(
    (sum, s) => sum + (s.executionJob?.result?.totalCount ?? 0),
    0,
  );
  const totalTestsPassed = finished.reduce(
    (sum, s) => sum + (s.executionJob?.result?.passedCount ?? 0),
    0,
  );

  const elapsedMs =
    interview.startedAt && interview.endedAt
      ? interview.endedAt.getTime() - interview.startedAt.getTime()
      : interview.startedAt
        ? Date.now() - interview.startedAt.getTime()
        : null;

  return {
    disclaimer: ANALYTICS_DISCLAIMER,
    interview: {
      id: interview.id,
      title: interview.title,
      status: interview.status,
      language: interview.language,
      scheduledAt: interview.scheduledAt,
      startedAt: interview.startedAt,
      endedAt: interview.endedAt,
      durationMinutes: interview.durationMinutes,
      elapsedMinutes: elapsedMs !== null ? Math.round(elapsedMs / 60_000) : null,
    },
    participants: interview.participants.map((p) => ({
      userId: p.userId,
      name: p.user.name,
      email: p.user.email,
      role: p.role,
      joinedAt: p.joinedAt,
    })),
    activity: {
      questionsAttached: interview.questions.length,
      questionsCompleted: perQuestion.filter((q) => q.completed).length,
      totalRuns: runs.length,
      runsByKind: {
        RUN: runs.filter((s) => s.kind === 'RUN').length,
        SUBMIT: runs.filter((s) => s.kind === 'SUBMIT').length,
      },
      executionStatusCounts: statusCounts,
      totalTestsRun,
      totalTestsPassed,
      medianExecutionMs: durations.length
        ? durations[Math.floor(durations.length / 2)] ?? 0
        : null,
      noteCount: interview.notes.length,
      privateNoteCount: interview.notes.filter((n) => n.isPrivate).length,
      aiSuggestionCount: interview.aiSuggestions.length,
      aiCostUsd: interview.aiSuggestions.reduce((sum, a) => sum + Number(a.costUsd.toString()), 0),
    },
    perQuestion,
    evaluations: interview.evaluations.map((e) => ({
      id: e.id,
      author: e.author,
      recommendation: e.recommendation,
      submittedAt: e.submittedAt,
      updatedAt: e.updatedAt,
      hasSummary: e.summary.trim().length > 0,
    })),
  };
}

/** Organization dashboard figures. All derived from real rows — nothing hardcoded. */
export async function organizationOverview(organizationId: string) {
  const since30d = new Date(Date.now() - 30 * 86_400_000);

  const [byStatus, upcoming, recentlyCompleted, questionCount, memberCount, runs30d, aiCost] =
    await Promise.all([
      prisma.interview.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      prisma.interview.findMany({
        where: {
          organizationId,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 5,
        include: {
          participants: { include: { user: { select: { id: true, name: true } } } },
        },
      }),
      prisma.interview.findMany({
        where: { organizationId, status: 'COMPLETED' },
        orderBy: { endedAt: 'desc' },
        take: 5,
        include: { evaluations: { select: { id: true, submittedAt: true } } },
      }),
      prisma.question.count({ where: { organizationId, isArchived: false } }),
      prisma.membership.groupBy({
        by: ['role'],
        where: { organizationId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      prisma.submission.count({
        where: { interview: { organizationId }, createdAt: { gte: since30d } },
      }),
      prisma.aiSuggestion.aggregate({
        where: { interview: { organizationId }, createdAt: { gte: since30d } },
        _sum: { costUsd: true },
        _count: true,
      }),
    ]);

  return {
    interviewsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    totalInterviews: byStatus.reduce((sum, s) => sum + s._count._all, 0),
    activeQuestions: questionCount,
    membersByRole: Object.fromEntries(memberCount.map((m) => [m.role, m._count._all])),
    codeRunsLast30Days: runs30d,
    ai: {
      requestsLast30Days: aiCost._count,
      costUsdLast30Days: aiCost._sum.costUsd ? Number(aiCost._sum.costUsd.toString()) : 0,
    },
    upcoming: upcoming.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      scheduledAt: i.scheduledAt,
      language: i.language,
      participants: i.participants.map((p) => ({ userId: p.userId, name: p.user.name, role: p.role })),
    })),
    recentlyCompleted: recentlyCompleted.map((i) => ({
      id: i.id,
      title: i.title,
      endedAt: i.endedAt,
      evaluationCount: i.evaluations.length,
      submittedEvaluationCount: i.evaluations.filter((e) => e.submittedAt).length,
    })),
  };
}
