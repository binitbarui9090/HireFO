import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  EXECUTION_EVENTS_CHANNEL,
  executionJobPayloadSchema,
  outputsMatch,
  type ExecutionEvent,
  type ExecutionJobPayload,
  type ExecutionTestCase,
} from '@hirefo/shared';
import { logger } from './logger.js';
import { sandboxRunner, type RunOutcome } from './runners/index.js';

export interface ProcessorDeps {
  prisma: PrismaClient;
  publisher: Redis;
}

/** Pushes progress to the API, which relays it to the browser over Socket.IO. */
async function publish(deps: ProcessorDeps, event: ExecutionEvent): Promise<void> {
  try {
    await deps.publisher.publish(EXECUTION_EVENTS_CHANNEL, JSON.stringify(event));
  } catch (err) {
    // A lost progress event must not fail the job: the result is still written to
    // Postgres and the client's polling fallback will pick it up.
    logger.warn({ err, executionJobId: event.executionJobId }, 'failed to publish execution event');
  }
}

function describeFailure(outcome: RunOutcome, timeoutMs: number): string | null {
  if (outcome.infraError) return `Execution infrastructure error: ${outcome.infraError}`;
  if (outcome.timedOut) return `Exceeded the ${timeoutMs}ms time limit and was terminated.`;
  if (outcome.oomKilled) return 'Exceeded the memory limit and was terminated by the kernel.';
  if (outcome.exitCode !== 0 && outcome.exitCode !== null) {
    return `Exited with code ${outcome.exitCode}.`;
  }
  return null;
}

/**
 * Runs one submission.
 *
 * Shape of the work:
 *   1. mark RUNNING, announce it
 *   2. optional compile/type check (one container); on failure stop before running
 *      anything, and report the compiler output
 *   3. run each test case in its own fresh container, comparing normalised stdout
 *   4. persist ExecutionResult + one TestCaseResult per case, mark terminal status
 *
 * Every path ends in a terminal status with a row in the database, including
 * infrastructure failures — a job never silently disappears.
 */
export async function processExecutionJob(
  rawPayload: unknown,
  deps: ProcessorDeps,
  attempt: number,
): Promise<{ status: string; passed: number; total: number }> {
  const payload: ExecutionJobPayload = executionJobPayloadSchema.parse(rawPayload);
  const runner = sandboxRunner();
  const log = logger.child({
    executionJobId: payload.executionJobId,
    language: payload.language,
    runner: runner.kind,
  });

  const startedAt = new Date();
  await deps.prisma.executionJob.update({
    where: { id: payload.executionJobId },
    data: { status: 'RUNNING', startedAt, attempts: attempt },
  });
  await publish(deps, {
    executionJobId: payload.executionJobId,
    submissionId: payload.submissionId,
    interviewId: payload.interviewId,
    status: 'RUNNING',
    totalCount: payload.testCases.length,
  });

  const begin = Date.now();
  let compileOutput: string | null = null;

  // --- compile / type check ------------------------------------------------
  if (runner.check) {
    const check = await runner.check({
      language: payload.language,
      code: payload.code,
      timeoutMs: payload.limits.perCaseTimeoutMs,
      limits: payload.limits,
      jobId: payload.executionJobId,
    });

    if (check.infraError) {
      return finishWithError(
        deps,
        payload,
        begin,
        'ERROR',
        `Compile step could not run: ${check.infraError}`,
      );
    }
    compileOutput = check.output || null;
    if (!check.ok) {
      log.info('submission failed the compile/type check');
      return finishJob(deps, payload, {
        begin,
        status: 'FAILED',
        compileOutput: check.output || 'The compiler reported errors but produced no output.',
        results: [],
        aggregate: { stdout: '', stderr: '', exitCode: null, timedOut: false, oomKilled: false },
        errorMessage: null,
      });
    }
  }

  // --- test cases ----------------------------------------------------------
  const results: {
    testCase: ExecutionTestCase;
    outcome: RunOutcome;
    passed: boolean;
    errorMessage: string | null;
  }[] = [];

  let passed = 0;
  let infraFailure: string | null = null;

  for (const testCase of payload.testCases) {
    const budget = Math.min(testCase.timeoutMs, payload.limits.perCaseTimeoutMs);
    const elapsed = Date.now() - begin;
    if (elapsed > payload.limits.jobTimeoutMs) {
      infraFailure = `The job exceeded its overall ${payload.limits.jobTimeoutMs}ms budget after ${results.length} of ${payload.testCases.length} cases.`;
      break;
    }

    const outcome = await runner.run({
      language: payload.language,
      code: payload.code,
      stdin: testCase.input,
      timeoutMs: budget,
      limits: payload.limits,
      jobId: payload.executionJobId,
      caseId: testCase.id,
    });

    if (outcome.infraError) {
      infraFailure = outcome.infraError;
      break;
    }

    const ranCleanly = outcome.exitCode === 0 && !outcome.timedOut && !outcome.oomKilled;
    // The ad-hoc console run has no expectation to meet; a clean exit is a pass.
    const isAdHoc = testCase.id === 'adhoc';
    const casePassed = isAdHoc
      ? ranCleanly
      : ranCleanly && outputsMatch(outcome.stdout, testCase.expectedOutput);
    if (casePassed) passed += 1;

    results.push({
      testCase,
      outcome,
      passed: casePassed,
      errorMessage: describeFailure(outcome, budget),
    });

    await publish(deps, {
      executionJobId: payload.executionJobId,
      submissionId: payload.submissionId,
      interviewId: payload.interviewId,
      status: 'RUNNING',
      passedCount: passed,
      totalCount: payload.testCases.length,
    });
  }

  if (infraFailure && results.length === 0) {
    return finishWithError(deps, payload, begin, 'ERROR', infraFailure);
  }

  const anyTimeout = results.some((r) => r.outcome.timedOut);
  const allPassed = results.length === payload.testCases.length && passed === results.length;
  const status = infraFailure
    ? 'ERROR'
    : allPassed
      ? 'SUCCEEDED'
      : anyTimeout && passed === 0
        ? 'TIMEOUT'
        : 'FAILED';

  // The console/aggregate view shows the first failing case, or the last case when
  // everything passed — that is what the candidate most likely wants to read.
  const focus = results.find((r) => !r.passed) ?? results[results.length - 1];

  return finishJob(deps, payload, {
    begin,
    status,
    compileOutput,
    results,
    aggregate: {
      stdout: focus?.outcome.stdout ?? '',
      stderr: focus?.outcome.stderr ?? '',
      exitCode: focus?.outcome.exitCode ?? null,
      timedOut: focus?.outcome.timedOut ?? false,
      oomKilled: focus?.outcome.oomKilled ?? false,
    },
    errorMessage: infraFailure,
  });
}

async function finishJob(
  deps: ProcessorDeps,
  payload: ExecutionJobPayload,
  params: {
    begin: number;
    status: string;
    compileOutput: string | null;
    results: {
      testCase: ExecutionTestCase;
      outcome: RunOutcome;
      passed: boolean;
      errorMessage: string | null;
    }[];
    aggregate: {
      stdout: string;
      stderr: string;
      exitCode: number | null;
      timedOut: boolean;
      oomKilled: boolean;
    };
    errorMessage: string | null;
  },
): Promise<{ status: string; passed: number; total: number }> {
  const durationMs = Date.now() - params.begin;
  const passedCount = params.results.filter((r) => r.passed).length;
  const totalCount = payload.testCases.length;

  // One transaction: the job's terminal status and all of its results land together.
  await deps.prisma.$transaction(async (tx) => {
    await tx.executionJob.update({
      where: { id: payload.executionJobId },
      data: {
        status: params.status as never,
        finishedAt: new Date(),
        durationMs,
        errorMessage: params.errorMessage,
      },
    });

    await tx.executionResult.upsert({
      where: { executionJobId: payload.executionJobId },
      create: {
        executionJobId: payload.executionJobId,
        compileOutput: params.compileOutput,
        stdout: params.aggregate.stdout,
        stderr: params.aggregate.stderr,
        exitCode: params.aggregate.exitCode,
        timedOut: params.aggregate.timedOut,
        oomKilled: params.aggregate.oomKilled,
        durationMs,
        passedCount,
        totalCount,
      },
      update: {
        compileOutput: params.compileOutput,
        stdout: params.aggregate.stdout,
        stderr: params.aggregate.stderr,
        exitCode: params.aggregate.exitCode,
        timedOut: params.aggregate.timedOut,
        oomKilled: params.aggregate.oomKilled,
        durationMs,
        passedCount,
        totalCount,
      },
    });

    // The ad-hoc console case has no TestCase row to reference.
    const persistable = params.results.filter((r) => r.testCase.id !== 'adhoc');
    for (const result of persistable) {
      await tx.testCaseResult.upsert({
        where: {
          executionJobId_testCaseId: {
            executionJobId: payload.executionJobId,
            testCaseId: result.testCase.id,
          },
        },
        create: {
          executionJobId: payload.executionJobId,
          testCaseId: result.testCase.id,
          passed: result.passed,
          actualOutput: result.outcome.stdout,
          stderr: result.outcome.stderr,
          exitCode: result.outcome.exitCode,
          timedOut: result.outcome.timedOut,
          durationMs: result.outcome.durationMs,
          errorMessage: result.errorMessage,
        },
        update: {
          passed: result.passed,
          actualOutput: result.outcome.stdout,
          stderr: result.outcome.stderr,
          exitCode: result.outcome.exitCode,
          timedOut: result.outcome.timedOut,
          durationMs: result.outcome.durationMs,
          errorMessage: result.errorMessage,
        },
      });
    }
  });

  await publish(deps, {
    executionJobId: payload.executionJobId,
    submissionId: payload.submissionId,
    interviewId: payload.interviewId,
    status: params.status as ExecutionEvent['status'],
    passedCount,
    totalCount,
    ...(params.errorMessage ? { message: params.errorMessage } : {}),
  });

  logger.info(
    { executionJobId: payload.executionJobId, status: params.status, passedCount, totalCount, durationMs },
    'execution finished',
  );

  return { status: params.status, passed: passedCount, total: totalCount };
}

function finishWithError(
  deps: ProcessorDeps,
  payload: ExecutionJobPayload,
  begin: number,
  status: string,
  message: string,
): Promise<{ status: string; passed: number; total: number }> {
  logger.error({ executionJobId: payload.executionJobId, message }, 'execution could not run');
  return finishJob(deps, payload, {
    begin,
    status,
    compileOutput: null,
    results: [],
    aggregate: { stdout: '', stderr: '', exitCode: null, timedOut: false, oomKilled: false },
    errorMessage: message,
  });
}
