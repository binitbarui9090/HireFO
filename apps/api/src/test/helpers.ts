/**
 * Integration-test helpers: a real Express app over a real Postgres database.
 *
 * Nothing here is mocked except the execution queue, because enqueueing talks to
 * Redis and the sandbox itself is covered by the worker's own suite. Everything
 * else — auth, tenancy, validation, transactions, audit — runs for real.
 */
import type { Express } from 'express';
import request from 'supertest';
import { ORG_HEADER } from '../middleware/auth.js';
import { prisma } from '../db/prisma.js';
import { createApp } from '../http/app.js';
import { hashPassword } from '../services/passwords.js';

export const TEST_PASSWORD = 'test-password-1234';

let cachedApp: Express | null = null;

export function app(): Express {
  cachedApp ??= createApp();
  return cachedApp;
}

/**
 * Wipes every table. Order matters only for speed — TRUNCATE ... CASCADE handles
 * the dependencies — but listing them explicitly keeps the intent obvious.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditEvent", "Evaluation", "EvaluationRubric", "InterviewNote",
      "AiSuggestion", "TestCaseResult", "ExecutionResult", "ExecutionJob",
      "Submission", "CodeDocument", "InterviewParticipant", "InterviewQuestion",
      "Interview", "TestCase", "Question", "Invitation", "Session",
      "Membership", "Organization", "User"
    RESTART IDENTITY CASCADE
  `);
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  token: string;
  organizationId: string;
  role: 'ADMIN' | 'INTERVIEWER' | 'CANDIDATE';
}

export interface TestOrg {
  id: string;
  name: string;
  slug: string;
}

/** Registers an organization through the real API and returns its admin. */
export async function createOrgWithAdmin(
  name: string,
  email: string,
): Promise<{ org: TestOrg; admin: TestUser }> {
  const res = await request(app())
    .post('/api/auth/register')
    .send({ name: `Admin of ${name}`, email, password: TEST_PASSWORD, organizationName: name })
    .expect(200);

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: res.body.organizationId as string },
  });

  return {
    org: { id: org.id, name: org.name, slug: org.slug },
    admin: {
      id: res.body.user.id as string,
      email,
      name: res.body.user.name as string,
      token: res.body.accessToken as string,
      organizationId: org.id,
      role: 'ADMIN',
    },
  };
}

/**
 * Adds a member directly, then logs them in through the API so the returned
 * token comes from the real auth path.
 */
export async function addMember(
  organizationId: string,
  email: string,
  role: 'ADMIN' | 'INTERVIEWER' | 'CANDIDATE',
  name = email.split('@')[0]!,
): Promise<TestUser> {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash },
    update: { passwordHash },
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId } },
    create: { userId: user.id, organizationId, role, status: 'ACTIVE' },
    update: { role, status: 'ACTIVE' },
  });

  const res = await request(app())
    .post('/api/auth/login')
    .send({ email, password: TEST_PASSWORD })
    .expect(200);

  return {
    id: user.id,
    email,
    name,
    token: res.body.accessToken as string,
    organizationId,
    role,
  };
}

/** Authenticated request builder, scoped to the user's organization. */
export function as(user: TestUser) {
  const agent = request(app());
  const withHeaders = <T extends request.Test>(req: T): T =>
    req.set('authorization', `Bearer ${user.token}`).set(ORG_HEADER, user.organizationId) as T;

  return {
    get: (path: string) => withHeaders(agent.get(path)),
    post: (path: string) => withHeaders(agent.post(path)),
    put: (path: string) => withHeaders(agent.put(path)),
    patch: (path: string) => withHeaders(agent.patch(path)),
    delete: (path: string) => withHeaders(agent.delete(path)),
    /** Same credentials, but explicitly claiming a different organization. */
    asOrg: (organizationId: string) => as({ ...user, organizationId }),
  };
}

export interface SeededQuestion {
  id: string;
  publicCaseId: string;
  hiddenCaseId: string;
}

export async function seedQuestion(
  organizationId: string,
  createdById: string,
  overrides: { title?: string; languages?: string[] } = {},
): Promise<SeededQuestion> {
  const title = overrides.title ?? 'Echo the input';
  const question = await prisma.question.create({
    data: {
      organizationId,
      createdById,
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: 'Read a line from stdin and print it back unchanged.',
      difficulty: 'EASY',
      categories: ['ALGORITHMS'],
      languages: overrides.languages ?? ['javascript', 'python'],
      expectedComplexity: 'O(n)',
      hints: ['Ask them what stdin contains.', 'Point at readFileSync(0).'],
      evaluationCriteria: ['Reads stdin correctly'],
      examples: [{ input: 'abc', output: 'abc' }],
      starterCode: { javascript: '// solve me\n' },
      testCases: {
        create: [
          {
            name: 'Visible example',
            input: 'abc',
            expectedOutput: 'abc',
            visibility: 'PUBLIC',
            orderIndex: 0,
          },
          {
            name: 'Hidden edge case',
            input: 'xyz',
            expectedOutput: 'xyz',
            visibility: 'HIDDEN',
            explanation: 'Interviewer-only note.',
            orderIndex: 1,
          },
        ],
      },
    },
    include: { testCases: { orderBy: { orderIndex: 'asc' } } },
  });

  return {
    id: question.id,
    publicCaseId: question.testCases[0]!.id,
    hiddenCaseId: question.testCases[1]!.id,
  };
}

export async function seedInterview(
  organizationId: string,
  createdById: string,
  opts: {
    questionIds?: string[];
    interviewerIds?: string[];
    candidateId?: string;
    status?: 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    title?: string;
  } = {},
): Promise<string> {
  const interview = await prisma.interview.create({
    data: {
      organizationId,
      createdById,
      title: opts.title ?? 'Technical round',
      language: 'javascript',
      status: opts.status ?? 'IN_PROGRESS',
      durationMinutes: 60,
      startedAt: opts.status === 'IN_PROGRESS' || !opts.status ? new Date() : null,
      questions: {
        create: (opts.questionIds ?? []).map((questionId, orderIndex) => ({
          questionId,
          orderIndex,
        })),
      },
      participants: {
        create: [
          ...(opts.interviewerIds ?? [createdById]).map((userId) => ({
            userId,
            role: 'INTERVIEWER' as const,
          })),
          ...(opts.candidateId ? [{ userId: opts.candidateId, role: 'CANDIDATE' as const }] : []),
        ],
      },
      ...(opts.questionIds?.length ? { activeQuestionId: opts.questionIds[0] } : {}),
    },
  });
  return interview.id;
}

/** Reads the audit log directly — the API only exposes it to admins. */
export async function auditActions(organizationId?: string): Promise<string[]> {
  const events = await prisma.auditEvent.findMany({
    ...(organizationId ? { where: { organizationId } } : {}),
    orderBy: { createdAt: 'asc' },
    select: { action: true },
  });
  return events.map((e) => e.action);
}
