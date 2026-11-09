/**
 * Organization isolation.
 *
 * Every one of these tests sets up two unrelated organizations and then tries to
 * reach across the boundary. The expected result is almost always 404 rather than
 * 403: confirming that an id exists elsewhere is itself a leak.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import {
  addMember,
  as,
  createOrgWithAdmin,
  resetDatabase,
  seedInterview,
  seedQuestion,
  type TestOrg,
  type TestUser,
} from '../test/helpers.js';

interface Tenant {
  org: TestOrg;
  admin: TestUser;
  interviewer: TestUser;
  candidate: TestUser;
  questionId: string;
  hiddenCaseId: string;
  interviewId: string;
}

async function makeTenant(name: string, domain: string): Promise<Tenant> {
  const { org, admin } = await createOrgWithAdmin(name, `admin@${domain}`);
  const interviewer = await addMember(org.id, `interviewer@${domain}`, 'INTERVIEWER');
  const candidate = await addMember(org.id, `candidate@${domain}`, 'CANDIDATE');
  const question = await seedQuestion(org.id, admin.id, { title: `${name} question` });
  const interviewId = await seedInterview(org.id, interviewer.id, {
    questionIds: [question.id],
    interviewerIds: [interviewer.id, admin.id],
    candidateId: candidate.id,
    title: `${name} interview`,
  });
  return {
    org,
    admin,
    interviewer,
    candidate,
    questionId: question.id,
    hiddenCaseId: question.hiddenCaseId,
    interviewId,
  };
}

describe('organization isolation', () => {
  let a: Tenant;
  let b: Tenant;

  beforeEach(async () => {
    await resetDatabase();
    a = await makeTenant('Acme', 'acme.test');
    b = await makeTenant('Globex', 'globex.test');
  });


  describe('the org header cannot be used to switch tenants', () => {
    it('rejects a header naming an organization the caller does not belong to', async () => {
      const res = await as(a.admin).asOrg(b.org.id).get('/api/interviews').expect(403);
      expect(res.body.error.message).toMatch(/not a member of that organization/);
    });

    it('audits the attempt so it is visible to the other tenant', async () => {
      await as(a.admin).asOrg(b.org.id).get('/api/interviews').expect(403);
      const denied = await prisma.auditEvent.findFirst({
        where: { action: 'access.denied', actorId: a.admin.id },
      });
      expect(denied).not.toBeNull();
      expect((denied!.metadata as { reason?: string }).reason).toBe('not_a_member');
    });
  });

  describe('interviews', () => {
    it('does not list another tenant interviews', async () => {
      const res = await as(a.admin).get('/api/interviews').expect(200);
      const titles = (res.body.items as { title: string }[]).map((i) => i.title);
      expect(titles).toContain('Acme interview');
      expect(titles).not.toContain('Globex interview');
    });

    it('reports another tenant interview as 404, not 403', async () => {
      await as(a.admin).get(`/api/interviews/${b.interviewId}`).expect(404);
    });

    it('refuses to modify another tenant interview', async () => {
      await as(a.admin).patch(`/api/interviews/${b.interviewId}`).send({ title: 'hijacked' }).expect(404);
      const unchanged = await prisma.interview.findUniqueOrThrow({ where: { id: b.interviewId } });
      expect(unchanged.title).toBe('Globex interview');
    });

    it('refuses to start, complete or cancel another tenant interview', async () => {
      await as(a.admin).post(`/api/interviews/${b.interviewId}/start`).expect(404);
      await as(a.admin).post(`/api/interviews/${b.interviewId}/complete`).expect(404);
      await as(a.admin).post(`/api/interviews/${b.interviewId}/cancel`).send({}).expect(404);
    });

    it('refuses to attach another tenant question to its own interview', async () => {
      const res = await as(a.admin)
        .patch(`/api/interviews/${a.interviewId}`)
        .send({ questionIds: [b.questionId] })
        .expect(400);
      expect(res.body.error.message).toMatch(/do not exist in this organization/);
    });

    it('refuses to add a user from another organization as a participant', async () => {
      const res = await as(a.admin)
        .post(`/api/interviews/${a.interviewId}/participants`)
        .send({ userId: b.candidate.id, role: 'CANDIDATE' })
        .expect(400);
      expect(res.body.error.message).toMatch(/not an active member/);
    });

    it('refuses to create an interview naming another tenant interviewer', async () => {
      await as(a.admin)
        .post('/api/interviews')
        .send({ title: 'Cross tenant', language: 'javascript', interviewerIds: [b.interviewer.id] })
        .expect(400);
    });
  });

  describe('questions', () => {
    it('does not list another tenant questions', async () => {
      const res = await as(a.admin).get('/api/questions').expect(200);
      const titles = (res.body.items as { title: string }[]).map((q) => q.title);
      expect(titles).toContain('Acme question');
      expect(titles).not.toContain('Globex question');
    });

    it('reports another tenant question as 404', async () => {
      await as(a.admin).get(`/api/questions/${b.questionId}`).expect(404);
      await as(a.admin).patch(`/api/questions/${b.questionId}`).send({ title: 'hijacked' }).expect(404);
    });

    it('does not leak another tenant hidden test cases through search', async () => {
      const res = await as(a.admin).get('/api/questions?search=Globex').expect(200);
      expect(res.body.items).toHaveLength(0);
    });
  });

  describe('executions, notes and evaluations', () => {
    it('refuses to read another tenant execution history', async () => {
      await as(a.admin).get(`/api/interviews/${b.interviewId}/executions`).expect(404);
    });

    it('refuses to submit code into another tenant interview', async () => {
      await as(a.admin)
        .post(`/api/interviews/${b.interviewId}/submissions`)
        .send({ language: 'javascript', code: 'console.log(1)', kind: 'RUN' })
        .expect(404);
    });

    it('refuses to read or write another tenant notes', async () => {
      await as(a.admin).get(`/api/interviews/${b.interviewId}/notes`).expect(404);
      await as(a.admin)
        .post(`/api/interviews/${b.interviewId}/notes`)
        .send({ body: 'intruding', isPrivate: true })
        .expect(404);
    });

    it('refuses to read another tenant analytics or evaluations', async () => {
      await as(a.admin).get(`/api/interviews/${b.interviewId}/analytics`).expect(404);
      await as(a.admin).get(`/api/interviews/${b.interviewId}/evaluations`).expect(404);
      await as(a.admin)
        .put(`/api/interviews/${b.interviewId}/evaluation`)
        .send({ summary: 'intruding' })
        .expect(404);
    });

    it('refuses to use another tenant rubric on its own evaluation', async () => {
      const bRubric = await prisma.evaluationRubric.findFirstOrThrow({
        where: { organizationId: b.org.id },
      });
      const res = await as(a.admin)
        .put(`/api/interviews/${a.interviewId}/evaluation`)
        .send({ rubricId: bRubric.id, summary: 'x' })
        .expect(404);
      expect(res.body.error.message).toMatch(/Rubric not found/);
    });

    it('refuses to request copilot output about another tenant interview', async () => {
      await as(a.admin)
        .post(`/api/ai/interviews/${b.interviewId}/suggestions`)
        .send({ kind: 'EDGE_CASES' })
        .expect(404);
    });
  });

  describe('team and audit', () => {
    it('lists only its own members', async () => {
      const res = await as(a.admin).get('/api/org/members').expect(200);
      const emails = (res.body.items as { email: string }[]).map((m) => m.email);
      expect(emails).toEqual(
        expect.arrayContaining(['admin@acme.test', 'interviewer@acme.test', 'candidate@acme.test']),
      );
      expect(emails.some((e) => e.endsWith('globex.test'))).toBe(false);
    });

    it('refuses to change a role in another organization', async () => {
      await as(a.admin).asOrg(b.org.id).patch(`/api/org/members/${b.candidate.id}`).send({ role: 'ADMIN' }).expect(403);
      const unchanged = await prisma.membership.findFirstOrThrow({
        where: { userId: b.candidate.id, organizationId: b.org.id },
      });
      expect(unchanged.role).toBe('CANDIDATE');
    });

    it('reports a non-member user as 404 when changing a role inside its own org', async () => {
      await as(a.admin).patch(`/api/org/members/${b.candidate.id}`).send({ role: 'ADMIN' }).expect(404);
    });

    it('shows only its own audit events', async () => {
      const res = await as(a.admin).get('/api/org/audit?pageSize=200').expect(200);
      const actorIds = (res.body.items as { actor: { id: string } | null }[])
        .map((e) => e.actor?.id)
        .filter(Boolean);
      expect(actorIds.some((id) => id === b.admin.id)).toBe(false);
    });

    it('keeps the organization overview scoped', async () => {
      const resA = await as(a.admin).get('/api/org/overview').expect(200);
      const resB = await as(b.admin).get('/api/org/overview').expect(200);
      expect(resA.body.totalInterviews).toBe(1);
      expect(resB.body.totalInterviews).toBe(1);
      expect(resA.body.activeQuestions).toBe(1);
    });
  });

  describe('candidate scoping within one organization', () => {
    it('hides interviews the candidate is not part of', async () => {
      const otherInterview = await seedInterview(a.org.id, a.interviewer.id, {
        questionIds: [a.questionId],
        interviewerIds: [a.interviewer.id],
        title: 'Someone else interview',
      });

      const list = await as(a.candidate).get('/api/interviews').expect(200);
      const titles = (list.body.items as { title: string }[]).map((i) => i.title);
      expect(titles).toContain('Acme interview');
      expect(titles).not.toContain('Someone else interview');

      await as(a.candidate).get(`/api/interviews/${otherInterview}`).expect(404);
    });

    it('lets the candidate read their own interview but not its hints', async () => {
      const res = await as(a.candidate).get(`/api/interviews/${a.interviewId}`).expect(200);
      expect(res.body.isStaff).toBe(false);
      expect(res.body.yourRole).toBe('CANDIDATE');
      expect(res.body.privateNotes).toBeNull();
      expect(res.body.questions[0].hints).toEqual([]);
      expect(res.body.questions[0].evaluationCriteria).toEqual([]);
    });

    it('blocks the candidate from the question library entirely', async () => {
      await as(a.candidate).get('/api/questions').expect(403);
      await as(a.candidate).get(`/api/questions/${a.questionId}`).expect(403);
    });

    it('blocks the candidate from the copilot, notes writing and evaluations', async () => {
      await as(a.candidate)
        .post(`/api/ai/interviews/${a.interviewId}/suggestions`)
        .send({ kind: 'EDGE_CASES' })
        .expect(403);
      await as(a.candidate)
        .post(`/api/interviews/${a.interviewId}/notes`)
        .send({ body: 'x', isPrivate: false })
        .expect(403);
      await as(a.candidate).get(`/api/interviews/${a.interviewId}/analytics`).expect(403);
      await as(a.candidate)
        .put(`/api/interviews/${a.interviewId}/evaluation`)
        .send({ summary: 'x' })
        .expect(403);
    });

    it('hides private notes from the candidate but shows shared ones', async () => {
      await as(a.interviewer)
        .post(`/api/interviews/${a.interviewId}/notes`)
        .send({ body: 'PRIVATE: struggled with the map', isPrivate: true })
        .expect(201);
      await as(a.interviewer)
        .post(`/api/interviews/${a.interviewId}/notes`)
        .send({ body: 'SHARED: we will follow up by email', isPrivate: false })
        .expect(201);

      const staffView = await as(a.interviewer).get(`/api/interviews/${a.interviewId}/notes`).expect(200);
      expect(staffView.body.items).toHaveLength(2);

      const candidateView = await as(a.candidate).get(`/api/interviews/${a.interviewId}/notes`).expect(200);
      expect(candidateView.body.items).toHaveLength(1);
      expect(candidateView.body.items[0].body).toContain('SHARED');
      expect(JSON.stringify(candidateView.body)).not.toContain('PRIVATE');
    });

    it('blocks a candidate from admin-only settings', async () => {
      await as(a.candidate).get('/api/org/members').expect(403);
      await as(a.candidate).get('/api/org/audit').expect(403);
      await as(a.candidate).get('/api/org/overview').expect(403);
    });

    it('blocks an interviewer from the admin-only audit log', async () => {
      await as(a.interviewer).get('/api/org/audit').expect(403);
      await as(a.admin).get('/api/org/audit').expect(200);
    });
  });
});
