import type { Difficulty, InterviewStatus, LanguageId, ParticipantRole } from '@hirefo/shared';

export interface InterviewParticipantDto {
  userId: string;
  role: ParticipantRole;
  name: string;
  email: string;
  avatarColor: number;
  joinedAt: string | null;
  lastSeenAt?: string | null;
}

export interface InterviewSummaryDto {
  id: string;
  title: string;
  status: InterviewStatus;
  language: LanguageId;
  difficulty: Difficulty | null;
  scheduledAt: string | null;
  durationMinutes: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  questionCount: number;
  submissionCount: number;
  participants: InterviewParticipantDto[];
}

export interface InterviewQuestionDto {
  questionId: string;
  orderIndex: number;
  title: string;
  difficulty: Difficulty;
  categories: string[];
  languages: string[];
  description: string;
  examples: { input: string; output: string; explanation?: string }[];
  starterCode: Record<string, string>;
  expectedComplexity: string | null;
  testCaseCount: number;
  hints: string[];
  evaluationCriteria: string[];
}

export interface InvitationDto {
  id: string;
  email: string;
  role: 'ADMIN' | 'INTERVIEWER' | 'CANDIDATE';
  expiresAt: string;
  acceptedAt: string | null;
}

export interface InterviewDetailDto {
  id: string;
  organizationId: string;
  title: string;
  status: InterviewStatus;
  language: LanguageId;
  difficulty: Difficulty | null;
  scheduledAt: string | null;
  durationMinutes: number;
  startedAt: string | null;
  endedAt: string | null;
  activeQuestionId: string | null;
  candidateEmail: string | null;
  cancelledReason: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  privateNotes: string | null;
  invitations: InvitationDto[];
  participants: InterviewParticipantDto[];
  questions: InterviewQuestionDto[];
  yourRole: ParticipantRole | null;
  isStaff: boolean;
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface QuestionSummaryDto {
  id: string;
  title: string;
  slug: string;
  difficulty: Difficulty;
  categories: string[];
  languages: string[];
  expectedComplexity: string | null;
  isArchived: boolean;
  createdBy: { id: string; name: string };
  updatedAt: string;
  testCaseCount: number;
  usedInInterviews: number;
}

export interface MemberDto {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  avatarColor: number;
  role: 'ADMIN' | 'INTERVIEWER' | 'CANDIDATE';
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  lastLoginAt: string | null;
  joinedAt: string;
}

export interface ExecutionHistoryItem {
  submissionId: string;
  createdAt: string;
  language: string;
  kind: 'RUN' | 'SUBMIT';
  author: { id: string; name: string };
  question: { id: string; title: string } | null;
  codeBytes: number;
  execution: {
    id: string;
    status: string;
    durationMs: number | null;
    passedCount: number | null;
    totalCount: number | null;
    errorMessage: string | null;
  } | null;
}

export interface TestResultDto {
  testCaseId: string;
  name: string;
  visibility: 'PUBLIC' | 'HIDDEN';
  weight: number;
  passed: boolean;
  durationMs: number;
  timedOut: boolean;
  input: string | null;
  expectedOutput: string | null;
  actualOutput: string | null;
  stderr: string | null;
  explanation: string | null;
  errorMessage: string | null;
  hiddenNotice: string | null;
}

export interface ExecutionDetailDto {
  id: string;
  status: string;
  runnerKind: 'DOCKER' | 'LOCAL_SUBPROCESS';
  attempts: number;
  errorMessage: string | null;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  submission: {
    id: string;
    interviewId: string;
    questionId: string | null;
    language: string;
    kind: 'RUN' | 'SUBMIT';
    userId: string;
    createdAt: string;
  };
  result: {
    compileOutput: string | null;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    oomKilled: boolean;
    durationMs: number;
    passedCount: number;
    totalCount: number;
  } | null;
  testResults: TestResultDto[];
}
