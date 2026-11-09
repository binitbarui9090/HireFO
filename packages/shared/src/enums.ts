/** Domain enums. These mirror the Prisma enums 1:1 — keep both in sync. */

export const ORG_ROLES = ['ADMIN', 'INTERVIEWER', 'CANDIDATE'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Ordered weakest -> strongest for permission comparisons. */
export const ROLE_RANK: Record<OrgRole, number> = {
  CANDIDATE: 0,
  INTERVIEWER: 1,
  ADMIN: 2,
};

export const MEMBERSHIP_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const INTERVIEW_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const PARTICIPANT_ROLES = ['INTERVIEWER', 'CANDIDATE', 'OBSERVER'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const QUESTION_CATEGORIES = [
  'JAVASCRIPT',
  'TYPESCRIPT',
  'REACT',
  'NODEJS',
  'PYTHON',
  'DATA_STRUCTURES',
  'ALGORITHMS',
  'SQL',
  'SYSTEM_DESIGN',
  'DEBUGGING',
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  JAVASCRIPT: 'JavaScript',
  TYPESCRIPT: 'TypeScript',
  REACT: 'React',
  NODEJS: 'Node.js',
  PYTHON: 'Python',
  DATA_STRUCTURES: 'Data Structures',
  ALGORITHMS: 'Algorithms',
  SQL: 'SQL',
  SYSTEM_DESIGN: 'System Design',
  DEBUGGING: 'Debugging',
};

export const TEST_CASE_VISIBILITIES = ['PUBLIC', 'HIDDEN'] as const;
export type TestCaseVisibility = (typeof TEST_CASE_VISIBILITIES)[number];

export const SUBMISSION_KINDS = ['RUN', 'SUBMIT'] as const;
/** RUN = candidate executes against public/example tests. SUBMIT = full run incl. hidden tests. */
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

export const EXECUTION_STATUSES = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'TIMEOUT',
  'ERROR',
  'CANCELLED',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const TERMINAL_EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  'SUCCEEDED',
  'FAILED',
  'TIMEOUT',
  'ERROR',
  'CANCELLED',
];

export const isTerminalExecutionStatus = (s: ExecutionStatus): boolean =>
  TERMINAL_EXECUTION_STATUSES.includes(s);

export const RUNNER_KINDS = ['DOCKER', 'LOCAL_SUBPROCESS'] as const;
export type RunnerKind = (typeof RUNNER_KINDS)[number];

export const AI_SUGGESTION_KINDS = [
  'EDGE_CASES',
  'FOLLOW_UP_QUESTIONS',
  'INTERVIEWER_HINT',
  'EXPLAIN_TEST_FAILURE',
  'DIFFICULTY_CALIBRATION',
  'REASONING_GAPS',
  'APPROACH_SUMMARY',
  'STRUCTURED_NOTES',
] as const;
export type AiSuggestionKind = (typeof AI_SUGGESTION_KINDS)[number];

export const AI_SUGGESTION_KIND_LABELS: Record<AiSuggestionKind, string> = {
  EDGE_CASES: 'Edge cases',
  FOLLOW_UP_QUESTIONS: 'Follow-up questions',
  INTERVIEWER_HINT: 'Hint to offer',
  EXPLAIN_TEST_FAILURE: 'Explain test failure',
  DIFFICULTY_CALIBRATION: 'Difficulty calibration',
  REASONING_GAPS: 'Possible reasoning gaps',
  APPROACH_SUMMARY: 'Approach summary',
  STRUCTURED_NOTES: 'Draft interviewer notes',
};

export const RECOMMENDATIONS = [
  'STRONG_NO',
  'NO',
  'LEAN_NO',
  'LEAN_YES',
  'YES',
  'STRONG_YES',
] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  STRONG_NO: 'Strong no',
  NO: 'No',
  LEAN_NO: 'Lean no',
  LEAN_YES: 'Lean yes',
  YES: 'Yes',
  STRONG_YES: 'Strong yes',
};

export const AUDIT_ACTIONS = [
  'auth.register',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.refresh',
  'org.create',
  'org.update',
  'org.member_role_change',
  'org.member_remove',
  'invitation.create',
  'invitation.accept',
  'invitation.revoke',
  'interview.create',
  'interview.update',
  'interview.cancel',
  'interview.start',
  'interview.complete',
  'interview.join',
  'interview.leave',
  'question.create',
  'question.update',
  'question.archive',
  'submission.create',
  'execution.enqueue',
  'execution.complete',
  'ai.suggestion',
  'note.create',
  'note.update',
  'note.delete',
  'evaluation.save',
  'evaluation.submit',
  'rubric.create',
  'access.denied',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
