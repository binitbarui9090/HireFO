/**
 * Execution pipeline, API side.
 *
 * These tests drive the real producer path — submission row, execution-job row,
 * BullMQ enqueue — and then run the real worker processor in-process against the
 * same database. That covers the contract between the two services without
 * needing a separate worker process.
 *
 * The sandbox itself (container flags, limits, kills) is covered by
 * apps/worker/src/runners/docker.test.ts.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import type { ExecutionJobPayload } from '@hirefo/shared';
import { config } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { executionQueue } from '../queue/executionQueue.js';
import {
  addMember,
  as,
  auditActions,
  createOrgWithAdmin,
  resetDatabase,
  seedInterview,
  seedQuestion,
  type TestOrg,
  type TestUser,
} from '../test/helpers.js';

// The worker's processor is imported directly: same code the worker process runs.
const { processExecutionJob } = await import('../../../worker/src/processor.js');

const publisher = new Redis(config().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });

/** Pulls the queued job off BullMQ and runs it through the real processor. */
async function drainQueue(executionJobId: string): Promise<void> {
  const job = await executionQueue().getJob(executionJobId);
  if (!job) throw new Error(`job ${executionJobId} was never enqueued`);
  await processExecutionJob(job.data as ExecutionJobPayload, { prisma, publisher }, 1);
  await job.remove().catch(() => undefined);
}

describe('execution pipeline', () => {
  let org: TestOrg;
  let admin: TestUser;
  let interviewer: TestUser;
  let candidate: TestUser;
  let questionId: string;
  let hiddenCaseId: string;
  let interviewId: string;

  beforeEach(async () => {
    await resetDatabase();
    await executionQueue().obliterate({ force: true }).catch(() => undefined);

    const created = await createOrgWithAdmin('Acme', 'admin@acme.test');
    org = created.org;
    admin = created.admin;
    interviewer = await addMember(org.id, 'interviewer@acme.test', 'INTERVIEWER');
    candidate = await addMember(org.id, 'candidate@acme.test', 'CANDIDATE');

    const question = await seedQuestion(org.id, admin.id);
    questionId = question.id;
    hiddenCaseId = question.hiddenCaseId;
    interviewId = await seedInterview(org.id, interviewer.id, {
      questionIds: [questionId],
      interviewerIds: [interviewer.id],
      candidateId: candidate.id,
    });
  });

  afterAll(async () => {
    await executionQueue().obliterate({ force: true }).catch(() => undefined);
    await publisher.quit().catch(() => publisher.disconnect());
    await prisma.$disconnect();
  });

  const ECHO = `const input = require('fs').readFileSync(0, 'utf8').trim();\nconsole.log(input);\n`;

  describe('enqueueing', () => {
    it('creates a submission and a QUEUED job, and returns 202', async () => {
      const res = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: ECHO, kind: 'RUN' })
        .expect(202);

      expect(res.body.status).toBe('QUEUED');

      const job = await prisma.executionJob.findUniqueOrThrow({
        where: { id: res.body.executionJobId as string },
        include: { submission: true },
      });
      expect(job.submission.code).toBe(ECHO);
      expect(job.submission.userId).toBe(candidate.id);
      expect(job.queueJobId).toBe(job.id);

      const actions = await auditActions(org.id);
      expect(actions).toContain('submission.create');
      expect(actions).toContain('execution.enqueue');
    });

    it('sends only public cases for RUN and every case for SUBMIT', async () => {
      const run = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: ECHO, kind: 'RUN' })
        .expect(202);
      const runJob = await executionQueue().getJob(run.body.executionJobId as string);
      const runCases = (runJob!.data as ExecutionJobPayload).testCases;
      expect(runCases).toHaveLength(1);
      expect(runCases[0]!.visibility).toBe('PUBLIC');

      const submit = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: ECHO, kind: 'SUBMIT' })
        .expect(202);
      const submitJob = await executionQueue().getJob(submit.body.executionJobId as string);
      expect((submitJob!.data as ExecutionJobPayload).testCases).toHaveLength(2);
    });

    it('clamps the payload limits to the configured ceilings', async () => {
      await prisma.testCase.update({
        where: { id: hiddenCaseId },
        data: { timeoutMs: 999_999 },
      });

      const res = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: ECHO, kind: 'SUBMIT' })
        .expect(202);

      const job = await executionQueue().getJob(res.body.executionJobId as string);
      const payload = job!.data as ExecutionJobPayload;
      expect(payload.limits.perCaseTimeoutMs).toBeLessThanOrEqual(15_000);
      expect(payload.testCases.every((c) => c.timeoutMs <= 15_000)).toBe(true);
      expect(payload.limits.memoryMb).toBe(256);
      expect(payload.limits.pidsLimit).toBe(64);
    });

    it('falls back to a single ad-hoc case when no question is attached', async () => {
      const scratch = await seedInterview(org.id, interviewer.id, {});
      const res = await as(interviewer)
        .post(`/api/interviews/${scratch}/submissions`)
        .send({ language: 'javascript', code: ECHO, kind: 'RUN', customStdin: 'hello' })
        .expect(202);

      const job = await executionQueue().getJob(res.body.executionJobId as string);
      const payload = job!.data as ExecutionJobPayload;
      expect(payload.testCases).toHaveLength(1);
      expect(payload.testCases[0]!.id).toBe('adhoc');
      expect(payload.testCases[0]!.input).toBe('hello');
    });

    it('rejects a non-executable language with 422 and an explanation', async () => {
      const res = await as(interviewer)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ language: 'sql', code: 'SELECT 1;', kind: 'RUN' })
        .expect(422);
      expect(res.body.error.message).toMatch(/no sandboxed runtime/);
    });

    it('rejects source above the size ceiling', async () => {
      await as(interviewer)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: 'x'.repeat(200_000), kind: 'RUN' })
        .expect(400);
    });

    it('refuses to run code on a completed or cancelled interview', async () => {
      for (const status of ['COMPLETED', 'CANCELLED'] as const) {
        const id = await seedInterview(org.id, interviewer.id, {
          questionIds: [questionId],
          status,
        });
        const res = await as(interviewer)
          .post(`/api/interviews/${id}/submissions`)
          .send({ questionId, language: 'javascript', code: ECHO, kind: 'RUN' })
          .expect(400);
        expect(res.body.error.message).toMatch(/cannot be run/);
      }
    });
  });

  describe('results, end to end through the real processor', () => {
    it('reports SUCCEEDED with every case passing for a correct solution', async () => {
      const res = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: ECHO, kind: 'SUBMIT' })
        .expect(202);
      await drainQueue(res.body.executionJobId as string);

      const detail = await as(interviewer)
        .get(`/api/interviews/${interviewId}/executions/${res.body.executionJobId}`)
        .expect(200);

      expect(detail.body.status).toBe('SUCCEEDED');
      expect(detail.body.result.passedCount).toBe(2);
      expect(detail.body.result.totalCount).toBe(2);
      expect(detail.body.testResults).toHaveLength(2);
      expect((detail.body.testResults as { passed: boolean }[]).every((t) => t.passed)).toBe(true);
      expect(await auditActions(org.id)).toContain('execution.enqueue');
    });

    it('reports FAILED with the expected/actual difference for a wrong answer', async () => {
      const res = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({
          questionId,
          language: 'javascript',
          code: `console.log('always-wrong');\n`,
          kind: 'SUBMIT',
        })
        .expect(202);
      await drainQueue(res.body.executionJobId as string);

      const detail = await as(interviewer)
        .get(`/api/interviews/${interviewId}/executions/${res.body.executionJobId}`)
        .expect(200);

      expect(detail.body.status).toBe('FAILED');
      expect(detail.body.result.passedCount).toBe(0);
      const failed = (detail.body.testResults as { expectedOutput: string; actualOutput: string }[])[0]!;
      expect(failed.expectedOutput).toBe('abc');
      expect(failed.actualOutput.trim()).toBe('always-wrong');
    });

    it('captures stderr and a non-zero exit for a crashing program', async () => {
      const res = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({
          questionId,
          language: 'javascript',
          code: `throw new Error('boom');\n`,
          kind: 'RUN',
        })
        .expect(202);
      await drainQueue(res.body.executionJobId as string);

      const detail = await as(interviewer)
        .get(`/api/interviews/${interviewId}/executions/${res.body.executionJobId}`)
        .expect(200);

      expect(detail.body.status).toBe('FAILED');
      expect(detail.body.result.stderr).toContain('boom');
      expect(detail.body.result.exitCode).not.toBe(0);
      expect(detail.body.testResults[0].errorMessage).toMatch(/Exited with code/);
    });

    it('compares output after trimming trailing whitespace', async () => {
      const res = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({
          questionId,
          language: 'javascript',
          // Deliberately noisy: trailing spaces and extra newlines must not fail.
          code: `const i = require('fs').readFileSync(0,'utf8').trim();\nprocess.stdout.write(i + '   \\n\\n');\n`,
          kind: 'RUN',
        })
        .expect(202);
      await drainQueue(res.body.executionJobId as string);

      const detail = await as(interviewer)
        .get(`/api/interviews/${interviewId}/executions/${res.body.executionJobId}`)
        .expect(200);
      expect(detail.body.status).toBe('SUCCEEDED');
    });

    it('always reaches a terminal status with a stored result', async () => {
      const res = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: ECHO, kind: 'RUN' })
        .expect(202);
      await drainQueue(res.body.executionJobId as string);

      const job = await prisma.executionJob.findUniqueOrThrow({
        where: { id: res.body.executionJobId as string },
        include: { result: true },
      });
      expect(['SUCCEEDED', 'FAILED', 'TIMEOUT', 'ERROR', 'CANCELLED']).toContain(job.status);
      expect(job.finishedAt).not.toBeNull();
      expect(job.durationMs).toBeGreaterThanOrEqual(0);
      expect(job.result).not.toBeNull();
    });
  });

  describe('hidden test case confidentiality', () => {
    it('hides hidden-case details from the candidate but not from staff', async () => {
      const res = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: ECHO, kind: 'SUBMIT' })
        .expect(202);
      await drainQueue(res.body.executionJobId as string);

      const path = `/api/interviews/${interviewId}/executions/${res.body.executionJobId}`;

      const candidateView = await as(candidate).get(path).expect(200);
      const hidden = (candidateView.body.testResults as {
        visibility: string;
        input: string | null;
        expectedOutput: string | null;
        actualOutput: string | null;
        hiddenNotice: string | null;
        passed: boolean;
        name: string;
      }[]).find((t) => t.visibility === 'HIDDEN')!;

      // Pass/fail and the name are visible; the data behind the case is not.
      expect(hidden.name).toBe('Hidden edge case');
      expect(hidden.passed).toBe(true);
      expect(hidden.input).toBeNull();
      expect(hidden.expectedOutput).toBeNull();
      expect(hidden.actualOutput).toBeNull();
      expect(hidden.hiddenNotice).toMatch(/interviewer only/);

      // The aggregate console view must not leak the hidden case either: the
      // worker focuses on the last case, which here is the hidden one.
      expect(candidateView.body.result.redacted).toBe(true);
      expect(candidateView.body.result.redactionNotice).toMatch(/visible cases only/);
      expect(candidateView.body.result.stdout.trim()).toBe('abc');
      expect(JSON.stringify(candidateView.body)).not.toContain('xyz');
      expect(JSON.stringify(candidateView.body)).not.toContain('Interviewer-only note');

      const staffView = await as(interviewer).get(path).expect(200);
      const staffHidden = (staffView.body.testResults as { visibility: string; input: string }[]).find(
        (t) => t.visibility === 'HIDDEN',
      )!;
      expect(staffHidden.input).toBe('xyz');
      expect(staffView.body.result.redacted).toBe(false);
      expect(staffView.body.result.stdout.trim()).toBe('xyz');
    });

    it('shows no program output at all when every case in the run is hidden', async () => {
      await prisma.testCase.update({
        where: { id: questionId ? (await prisma.testCase.findFirstOrThrow({
          where: { questionId, visibility: 'PUBLIC' },
        })).id : '' },
        data: { visibility: 'HIDDEN' },
      });

      const res = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: ECHO, kind: 'SUBMIT' })
        .expect(202);
      await drainQueue(res.body.executionJobId as string);

      const view = await as(candidate)
        .get(`/api/interviews/${interviewId}/executions/${res.body.executionJobId}`)
        .expect(200);

      expect(view.body.result.redacted).toBe(true);
      expect(view.body.result.stdout).toBe('');
      expect(view.body.result.redactionNotice).toMatch(/Every case in this run is hidden/);
      // Pass/fail counts are still reported.
      expect(view.body.result.passedCount).toBe(2);
    });

    it('never sends hidden expected output in the RUN payload', async () => {
      const res = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: ECHO, kind: 'RUN' })
        .expect(202);
      const job = await executionQueue().getJob(res.body.executionJobId as string);
      expect(JSON.stringify((job!.data as ExecutionJobPayload).testCases)).not.toContain('xyz');
    });
  });

  describe('history', () => {
    it('lists runs newest first with their outcome', async () => {
      for (const kind of ['RUN', 'SUBMIT'] as const) {
        const res = await as(candidate)
          .post(`/api/interviews/${interviewId}/submissions`)
          .send({ questionId, language: 'javascript', code: ECHO, kind })
          .expect(202);
        await drainQueue(res.body.executionJobId as string);
      }

      const history = await as(interviewer)
        .get(`/api/interviews/${interviewId}/executions`)
        .expect(200);

      expect(history.body.items).toHaveLength(2);
      expect(history.body.items[0].kind).toBe('SUBMIT');
      expect(history.body.items[0].execution.status).toBe('SUCCEEDED');
      expect(history.body.items[0].execution.passedCount).toBe(2);
      expect(history.body.items[0].codeBytes).toBeGreaterThan(0);
    });
  });

  describe('analytics derived from real runs', () => {
    it('counts runs and completions from stored results only', async () => {
      const good = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: ECHO, kind: 'SUBMIT' })
        .expect(202);
      await drainQueue(good.body.executionJobId as string);

      const bad = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: `console.log('no');\n`, kind: 'RUN' })
        .expect(202);
      await drainQueue(bad.body.executionJobId as string);

      const an = await as(interviewer).get(`/api/interviews/${interviewId}/analytics`).expect(200);

      expect(an.body.activity.totalRuns).toBe(2);
      expect(an.body.activity.runsByKind).toEqual({ RUN: 1, SUBMIT: 1 });
      expect(an.body.activity.totalTestsRun).toBe(3);
      expect(an.body.activity.totalTestsPassed).toBe(2);
      expect(an.body.perQuestion[0].completed).toBe(true);
      expect(an.body.perQuestion[0].bestPassed).toBe(2);
      expect(an.body.disclaimer).toMatch(/not a score/);
    });

    it('does not mark a question complete from a RUN alone', async () => {
      const res = await as(candidate)
        .post(`/api/interviews/${interviewId}/submissions`)
        .send({ questionId, language: 'javascript', code: ECHO, kind: 'RUN' })
        .expect(202);
      await drainQueue(res.body.executionJobId as string);

      const an = await as(interviewer).get(`/api/interviews/${interviewId}/analytics`).expect(200);
      // The public case passed, but hidden cases were never run, so it is not done.
      expect(an.body.perQuestion[0].completed).toBe(false);
      expect(an.body.activity.questionsCompleted).toBe(0);
    });
  });
});
