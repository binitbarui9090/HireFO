import { z } from 'zod';
import { LANGUAGE_IDS } from './languages.js';

/**
 * Contract between the API (producer) and the execution worker (consumer).
 *
 * The payload is intentionally self-contained: the worker receives the source and
 * the test cases it must run and does not reach back into application tables.
 * It writes results through a narrow set of execution tables only.
 */
export const executionTestCaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.string(),
  expectedOutput: z.string(),
  visibility: z.enum(['PUBLIC', 'HIDDEN']),
  timeoutMs: z.number().int().positive(),
  weight: z.number().int().positive(),
});

export const executionLimitsSchema = z.object({
  perCaseTimeoutMs: z.number().int().positive(),
  jobTimeoutMs: z.number().int().positive(),
  memoryMb: z.number().int().positive(),
  cpus: z.number().positive(),
  pidsLimit: z.number().int().positive(),
  tmpfsMb: z.number().int().positive(),
  maxOutputBytes: z.number().int().positive(),
});

export const executionJobPayloadSchema = z.object({
  executionJobId: z.string(),
  submissionId: z.string(),
  interviewId: z.string(),
  organizationId: z.string(),
  language: z.enum(LANGUAGE_IDS),
  code: z.string(),
  kind: z.enum(['RUN', 'SUBMIT']),
  testCases: z.array(executionTestCaseSchema),
  limits: executionLimitsSchema,
});

export type ExecutionTestCase = z.infer<typeof executionTestCaseSchema>;
export type ExecutionLimitsPayload = z.infer<typeof executionLimitsSchema>;
export type ExecutionJobPayload = z.infer<typeof executionJobPayloadSchema>;

export const EXECUTION_JOB_NAME = 'run-submission';

/** Redis pub/sub channel the worker uses to push progress back to API sockets. */
export const EXECUTION_EVENTS_CHANNEL = 'hirefo:execution:events';

export const executionEventSchema = z.object({
  executionJobId: z.string(),
  submissionId: z.string(),
  interviewId: z.string(),
  status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMEOUT', 'ERROR', 'CANCELLED']),
  passedCount: z.number().int().optional(),
  totalCount: z.number().int().optional(),
  message: z.string().optional(),
});

export type ExecutionEvent = z.infer<typeof executionEventSchema>;
