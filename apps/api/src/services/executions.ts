import {
  EXECUTION_LIMITS,
  LANGUAGES,
  type CreateSubmissionInput,
  type ExecutionJobPayload,
  type ExecutionTestCase,
  type LanguageId,
} from '@hirefo/shared';
import { config } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { enqueueExecution } from '../queue/executionQueue.js';

export interface CreateSubmissionContext {
  interviewId: string;
  organizationId: string;
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

function resolvedLimits(perCaseTimeoutMs: number) {
  return {
    perCaseTimeoutMs: Math.min(perCaseTimeoutMs, EXECUTION_LIMITS.perCaseTimeoutMsMax),
    jobTimeoutMs: EXECUTION_LIMITS.jobTimeoutMsMax,
    memoryMb: EXECUTION_LIMITS.memoryMb,
    cpus: EXECUTION_LIMITS.cpus,
    pidsLimit: EXECUTION_LIMITS.pidsLimit,
    tmpfsMb: EXECUTION_LIMITS.tmpfsMb,
    maxOutputBytes: EXECUTION_LIMITS.maxOutputBytes,
  };
}

/**
 * Creates a submission, its execution job row, and enqueues the job.
 *
 * The submission row and the job row are written in one transaction so an
 * ExecutionJob can never reference a missing submission. Enqueueing happens
 * *after* commit: if Redis is down the job stays QUEUED and is reported as such
 * rather than silently lost, and the caller gets a 503.
 */
export async function createSubmission(
  input: CreateSubmissionInput,
  ctx: CreateSubmissionContext,
) {
  const spec = LANGUAGES[input.language as LanguageId];
  if (!spec) throw badRequest(`Unknown language "${input.language}".`);
  if (!spec.executable) {
    throw unprocessable(
      `${spec.label} has no sandboxed runtime, so it cannot be executed. ${spec.executionNote}`,
    );
  }
  if (Buffer.byteLength(input.code, 'utf8') > EXECUTION_LIMITS.maxSourceBytes) {
    throw badRequest(`Source exceeds ${EXECUTION_LIMITS.maxSourceBytes} bytes.`);
  }

  let testCases: ExecutionTestCase[] = [];
  let perCaseTimeout: number = EXECUTION_LIMITS.perCaseTimeoutMsDefault;

  if (input.questionId) {
    const question = await prisma.question.findFirst({
      where: { id: input.questionId, organizationId: ctx.organizationId },
      include: { testCases: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!question) throw notFound('Question not found in this organization.');

    // RUN only exercises the examples the candidate can already see; SUBMIT adds
    // the hidden cases. Hidden expected output never leaves the server for RUN.
    const selected = question.testCases
      .filter((tc) => (input.kind === 'SUBMIT' ? true : tc.visibility === 'PUBLIC'))
      .slice(0, EXECUTION_LIMITS.maxTestCases);

    testCases = selected.map((tc) => ({
      id: tc.id,
      name: tc.name,
      input: tc.input,
      expectedOutput: tc.expectedOutput,
      visibility: tc.visibility,
      timeoutMs: Math.min(tc.timeoutMs, EXECUTION_LIMITS.perCaseTimeoutMsMax),
      weight: tc.weight,
    }));
    perCaseTimeout = Math.max(
      EXECUTION_LIMITS.perCaseTimeoutMsDefault,
      ...testCases.map((t) => t.timeoutMs),
    );
  }

  if (testCases.length === 0) {
    // No question, or a question with no runnable cases: do a single plain run so
    // the console still works. This is a real execution, just with one ad-hoc case.
    testCases = [
      {
        id: 'adhoc',
        name: 'Console run',
        input: input.customStdin ?? '',
        expectedOutput: '',
        visibility: 'PUBLIC',
        timeoutMs: EXECUTION_LIMITS.perCaseTimeoutMsDefault,
        weight: 1,
      },
    ];
  }

  const limits = resolvedLimits(perCaseTimeout);

  const { submission, job } = await prisma.$transaction(async (tx) => {
    const createdSubmission = await tx.submission.create({
      data: {
        interviewId: ctx.interviewId,
        questionId: input.questionId ?? null,
        userId: ctx.userId,
        language: input.language,
        code: input.code,
        kind: input.kind,
        customStdin: input.customStdin ?? null,
      },
    });
    const createdJob = await tx.executionJob.create({
      data: {
        submissionId: createdSubmission.id,
        status: 'QUEUED',
        runnerKind: config().EXECUTION_RUNNER,
        limits,
      },
    });
    await recordAudit(
      {
        action: 'submission.create',
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        targetType: 'submission',
        targetId: createdSubmission.id,
        metadata: {
          interviewId: ctx.interviewId,
          questionId: input.questionId ?? null,
          language: input.language,
          kind: input.kind,
          codeBytes: Buffer.byteLength(input.code, 'utf8'),
          testCaseCount: testCases.length,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      tx,
    );
    return { submission: createdSubmission, job: createdJob };
  });

  const payload: ExecutionJobPayload = {
    executionJobId: job.id,
    submissionId: submission.id,
    interviewId: ctx.interviewId,
    organizationId: ctx.organizationId,
    language: input.language,
    code: input.code,
    kind: input.kind,
    testCases,
    limits,
  };

  try {
    const queueJobId = await enqueueExecution(payload);
    await prisma.executionJob.update({ where: { id: job.id }, data: { queueJobId } });
  } catch (err) {
    await prisma.executionJob.update({
      where: { id: job.id },
      data: {
        status: 'ERROR',
        errorMessage: 'Could not reach the execution queue.',
        finishedAt: new Date(),
      },
    });
    throw err;
  }

  await recordAudit({
    action: 'execution.enqueue',
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    targetType: 'execution_job',
    targetId: job.id,
    metadata: { runner: config().EXECUTION_RUNNER, testCaseCount: testCases.length },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return { submissionId: submission.id, executionJobId: job.id, status: job.status as string };
}

/**
 * Loads an execution job with its results.
 *
 * `includeHidden` controls whether hidden test cases are revealed. Candidates see
 * only pass/fail plus the case name for hidden cases — never the expected output
 * or their own wrong output for a case they are not allowed to see.
 */
export async function getExecution(
  executionJobId: string,
  organizationId: string,
  includeHidden: boolean,
) {
  const job = await prisma.executionJob.findFirst({
    where: { id: executionJobId, submission: { interview: { organizationId } } },
    include: {
      result: true,
      submission: {
        select: {
          id: true,
          interviewId: true,
          questionId: true,
          language: true,
          kind: true,
          userId: true,
          createdAt: true,
        },
      },
      testResults: {
        include: { testCase: { select: { id: true, name: true, visibility: true, weight: true, explanation: true, input: true, expectedOutput: true } } },
      },
    },
  });
  if (!job) throw notFound('Execution not found.');

  /**
   * The stored aggregate (the "console" view) is the output of whichever case the
   * worker focused on — the first failure, or the last case. That case may be a
   * hidden one, so handing the aggregate straight to a candidate would leak the
   * hidden case's output even though the per-case rows are correctly redacted.
   *
   * For a non-staff viewer the console is therefore rebuilt from the public cases
   * alone. A job with no persisted cases at all (an ad-hoc console run, or a
   * compile failure) has nothing hidden in it and is shown as stored.
   */
  function consoleView() {
    if (!job!.result) return null;
    const stored = job!.result;
    const base = {
      compileOutput: stored.compileOutput,
      timedOut: stored.timedOut,
      oomKilled: stored.oomKilled,
      durationMs: stored.durationMs,
      passedCount: stored.passedCount,
      totalCount: stored.totalCount,
    };

    if (includeHidden || job!.testResults.length === 0) {
      return {
        ...base,
        stdout: stored.stdout,
        stderr: stored.stderr,
        exitCode: stored.exitCode,
        redacted: false as const,
        redactionNotice: null,
      };
    }

    const publicResults = job!.testResults.filter((tr) => tr.testCase.visibility === 'PUBLIC');
    if (publicResults.length === 0) {
      return {
        ...base,
        stdout: '',
        stderr: '',
        exitCode: null,
        redacted: true as const,
        redactionNotice:
          'Every case in this run is hidden, so no program output is shown. Pass/fail is above.',
      };
    }

    const focus = publicResults.find((tr) => !tr.passed) ?? publicResults[publicResults.length - 1]!;
    return {
      ...base,
      stdout: focus.actualOutput,
      stderr: focus.stderr,
      exitCode: focus.exitCode,
      redacted: true as const,
      redactionNotice:
        'Showing output from the visible cases only. Hidden cases ran but their output is not shown.',
    };
  }

  return {
    id: job.id,
    status: job.status,
    runnerKind: job.runnerKind,
    attempts: job.attempts,
    errorMessage: job.errorMessage,
    enqueuedAt: job.enqueuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.durationMs,
    limits: job.limits,
    submission: job.submission,
    result: consoleView(),
    testResults: job.testResults.map((tr) => {
      const isHidden = tr.testCase.visibility === 'HIDDEN';
      const reveal = includeHidden || !isHidden;
      return {
        testCaseId: tr.testCaseId,
        name: tr.testCase.name,
        visibility: tr.testCase.visibility,
        weight: tr.testCase.weight,
        passed: tr.passed,
        durationMs: tr.durationMs,
        timedOut: tr.timedOut,
        input: reveal ? tr.testCase.input : null,
        expectedOutput: reveal ? tr.testCase.expectedOutput : null,
        actualOutput: reveal ? tr.actualOutput : null,
        stderr: reveal ? tr.stderr : null,
        explanation: reveal ? tr.testCase.explanation : null,
        errorMessage: reveal ? tr.errorMessage : null,
        hiddenNotice: reveal ? null : 'Hidden test case — details visible to the interviewer only.',
      };
    }),
  };
}

export async function listExecutionHistory(interviewId: string, limit = 50) {
  const submissions = await prisma.submission.findMany({
    where: { interviewId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      user: { select: { id: true, name: true } },
      question: { select: { id: true, title: true } },
      executionJob: { include: { result: true } },
    },
  });

  return submissions.map((s) => ({
    submissionId: s.id,
    createdAt: s.createdAt,
    language: s.language,
    kind: s.kind,
    author: s.user,
    question: s.question,
    codeBytes: Buffer.byteLength(s.code, 'utf8'),
    execution: s.executionJob
      ? {
          id: s.executionJob.id,
          status: s.executionJob.status,
          durationMs: s.executionJob.durationMs,
          passedCount: s.executionJob.result?.passedCount ?? null,
          totalCount: s.executionJob.result?.totalCount ?? null,
          errorMessage: s.executionJob.errorMessage,
        }
      : null,
  }));
}
