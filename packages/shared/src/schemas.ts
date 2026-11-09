import { z } from 'zod';
import {
  AI_SUGGESTION_KINDS,
  DIFFICULTIES,
  INTERVIEW_STATUSES,
  ORG_ROLES,
  PARTICIPANT_ROLES,
  QUESTION_CATEGORIES,
  RECOMMENDATIONS,
  SUBMISSION_KINDS,
  TEST_CASE_VISIBILITIES,
} from './enums.js';
import { LANGUAGE_IDS } from './languages.js';
import { EXECUTION_LIMITS } from './limits.js';

export const cuidLike = z.string().min(8).max(64);

const PASSWORD_MESSAGE =
  'Password must be at least 12 characters and include a letter and a number.';

export const passwordSchema = z
  .string()
  .min(12, PASSWORD_MESSAGE)
  .max(200)
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), PASSWORD_MESSAGE);

export const emailSchema = z.string().trim().toLowerCase().email().max(320);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
  organizationName: z.string().trim().min(2).max(120),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(1).max(120).optional(),
  password: passwordSchema.optional(),
});

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: z.enum(ORG_ROLES).default('CANDIDATE'),
  interviewId: cuidLike.optional(),
  expiresInHours: z.number().int().min(1).max(720).default(168),
});

export const updateMemberSchema = z.object({
  role: z.enum(ORG_ROLES),
});

export const testCaseInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  input: z.string().max(EXECUTION_LIMITS.maxStdinBytes),
  expectedOutput: z.string().max(EXECUTION_LIMITS.maxOutputBytes),
  visibility: z.enum(TEST_CASE_VISIBILITIES).default('HIDDEN'),
  weight: z.number().int().min(1).max(100).default(1),
  timeoutMs: z
    .number()
    .int()
    .min(100)
    .max(EXECUTION_LIMITS.perCaseTimeoutMsMax)
    .default(EXECUTION_LIMITS.perCaseTimeoutMsDefault),
  explanation: z.string().max(2000).optional(),
});

export const questionExampleSchema = z.object({
  input: z.string().max(4000),
  output: z.string().max(4000),
  explanation: z.string().max(2000).optional(),
});

export const createQuestionSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(20000),
  difficulty: z.enum(DIFFICULTIES),
  categories: z.array(z.enum(QUESTION_CATEGORIES)).min(1).max(10),
  languages: z.array(z.enum(LANGUAGE_IDS)).min(1),
  expectedComplexity: z.string().trim().max(200).optional(),
  hints: z.array(z.string().trim().min(1).max(1000)).max(10).default([]),
  evaluationCriteria: z.array(z.string().trim().min(1).max(500)).max(15).default([]),
  examples: z.array(questionExampleSchema).max(10).default([]),
  starterCode: z.record(z.enum(LANGUAGE_IDS), z.string().max(EXECUTION_LIMITS.maxSourceBytes)).default({}),
  testCases: z.array(testCaseInputSchema).max(EXECUTION_LIMITS.maxTestCases).default([]),
});

export const updateQuestionSchema = createQuestionSchema.partial().extend({
  isArchived: z.boolean().optional(),
});

export const listQuestionsSchema = z.object({
  search: z.string().trim().max(200).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  category: z.enum(QUESTION_CATEGORIES).optional(),
  language: z.enum(LANGUAGE_IDS).optional(),
  includeArchived: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createInterviewSchema = z.object({
  title: z.string().trim().min(3).max(200),
  language: z.enum(LANGUAGE_IDS),
  scheduledAt: z.coerce.date().optional(),
  durationMinutes: z.number().int().min(10).max(480).default(60),
  difficulty: z.enum(DIFFICULTIES).optional(),
  questionIds: z.array(cuidLike).max(20).default([]),
  interviewerIds: z.array(cuidLike).max(10).default([]),
  candidateUserId: cuidLike.optional(),
  candidateEmail: emailSchema.optional(),
  privateNotes: z.string().max(10000).optional(),
});

export const updateInterviewSchema = createInterviewSchema
  .partial()
  .extend({ status: z.enum(INTERVIEW_STATUSES).optional() });

export const listInterviewsSchema = z.object({
  status: z.enum(INTERVIEW_STATUSES).optional(),
  search: z.string().trim().max(200).optional(),
  mine: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const addParticipantSchema = z.object({
  userId: cuidLike,
  role: z.enum(PARTICIPANT_ROLES),
});

export const createSubmissionSchema = z.object({
  // Accepts null as well as omission: the workspace sends null for the scratch
  // buffer, which has no question attached.
  questionId: cuidLike.nullish().transform((v) => v ?? undefined),
  language: z.enum(LANGUAGE_IDS),
  code: z.string().max(EXECUTION_LIMITS.maxSourceBytes),
  kind: z.enum(SUBMISSION_KINDS).default('RUN'),
  /** Ad-hoc stdin used when the submission is not tied to a question. */
  customStdin: z.string().max(EXECUTION_LIMITS.maxStdinBytes).optional(),
});

export const createNoteSchema = z.object({
  body: z.string().trim().min(1).max(20000),
  isPrivate: z.boolean().default(true),
  questionId: cuidLike.nullish().transform((v) => v ?? undefined),
});

export const updateNoteSchema = z.object({
  body: z.string().trim().min(1).max(20000).optional(),
  isPrivate: z.boolean().optional(),
});

export const rubricCriterionSchema = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  maxScore: z.number().int().min(1).max(10).default(5),
});

export const createRubricSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  criteria: z.array(rubricCriterionSchema).min(1).max(20),
  isDefault: z.boolean().default(false),
});

export const saveEvaluationSchema = z.object({
  rubricId: cuidLike.optional(),
  scores: z.record(z.string().max(60), z.number().int().min(0).max(10)).default({}),
  strengths: z.string().max(10000).default(''),
  concerns: z.string().max(10000).default(''),
  communicationObservations: z.string().max(10000).default(''),
  problemSolvingObservations: z.string().max(10000).default(''),
  summary: z.string().max(20000).default(''),
  recommendation: z.enum(RECOMMENDATIONS).optional(),
  submit: z.boolean().default(false),
});

export const aiSuggestionRequestSchema = z.object({
  kind: z.enum(AI_SUGGESTION_KINDS),
  questionId: cuidLike.nullish().transform((v) => v ?? undefined),
  /** Optional free-text steer from the interviewer. */
  instruction: z.string().trim().max(1000).optional(),
  /** Code snapshot the interviewer is looking at; falls back to the live document. */
  code: z.string().max(EXECUTION_LIMITS.maxSourceBytes).optional(),
  executionJobId: cuidLike.optional(),
  stream: z.boolean().default(false),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
export type SaveEvaluationInput = z.infer<typeof saveEvaluationSchema>;
export type AiSuggestionRequest = z.infer<typeof aiSuggestionRequestSchema>;
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;
export type TestCaseInput = z.infer<typeof testCaseInputSchema>;
export type QuestionExample = z.infer<typeof questionExampleSchema>;
