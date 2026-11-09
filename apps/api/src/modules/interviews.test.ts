import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
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

describe('interview management', () => {
  let org: TestOrg;
  let admin: TestUser;
  let interviewer: TestUser;
  let candidate: TestUser;
  let questionId: string;

  beforeEach(async () => {
    await resetDatabase();
    const created = await createOrgWithAdmin('Acme', 'admin@acme.test');
    org = created.org;
    admin = created.admin;
    interviewer = await addMember(org.id, 'interviewer@acme.test', 'INTERVIEWER');
    candidate = await addMember(org.id, 'candidate@acme.test', 'CANDIDATE');
    questionId = (await seedQuestion(org.id, admin.id)).id;
  });


  describe('creation', () => {
    it('creates an interview with questions, participants and an active question', async () => {
      const res = await as(interviewer)
        .post('/api/interviews')
        .send({
          title: 'Senior Frontend',
          language: 'javascript',
          durationMinutes: 45,
          difficulty: 'MEDIUM',
          questionIds: [questionId],
          candidateUserId: candidate.id,
          privateNotes: 'Probe React state.',
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      expect(res.body.activeQuestionId).toBe(questionId);
      expect(res.body.privateNotes).toBe('Probe React state.');
      expect(res.body.questions).toHaveLength(1);

      const roles = (res.body.participants as { role: string }[]).map((p) => p.role).sort();
      expect(roles).toEqual(['CANDIDATE', 'INTERVIEWER']);
      expect(await auditActions(org.id)).toContain('interview.create');
    });

    it('marks the interview SCHEDULED when a date is supplied', async () => {
      const res = await as(interviewer)
        .post('/api/interviews')
        .send({
          title: 'Scheduled round',
          language: 'python',
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .expect(201);
      expect(res.body.status).toBe('SCHEDULED');
    });

    it('always adds the creator as an interviewer', async () => {
      const res = await as(interviewer)
        .post('/api/interviews')
        .send({ title: 'Solo round', language: 'javascript' })
        .expect(201);
      const creator = (res.body.participants as { userId: string; role: string }[]).find(
        (p) => p.userId === interviewer.id,
      );
      expect(creator?.role).toBe('INTERVIEWER');
    });

    it('rejects an unknown language and a too-short title', async () => {
      await as(interviewer)
        .post('/api/interviews')
        .send({ title: 'Round', language: 'cobol' })
        .expect(400);
      await as(interviewer)
        .post('/api/interviews')
        .send({ title: 'ab', language: 'javascript' })
        .expect(400);
    });

    it('stops a candidate from creating an interview', async () => {
      await as(candidate)
        .post('/api/interviews')
        .send({ title: 'Self serve', language: 'javascript' })
        .expect(403);
    });
  });

  describe('status transitions', () => {
    it('walks DRAFT -> IN_PROGRESS -> COMPLETED and stamps the timestamps', async () => {
      const id = await seedInterview(org.id, interviewer.id, {
        questionIds: [questionId],
        status: 'DRAFT',
      });

      const started = await as(interviewer).post(`/api/interviews/${id}/start`).expect(200);
      expect(started.body.status).toBe('IN_PROGRESS');
      expect(started.body.startedAt).not.toBeNull();

      const completed = await as(interviewer).post(`/api/interviews/${id}/complete`).expect(200);
      expect(completed.body.status).toBe('COMPLETED');
      expect(completed.body.endedAt).not.toBeNull();

      const actions = await auditActions(org.id);
      expect(actions).toContain('interview.start');
      expect(actions).toContain('interview.complete');
    });

    it('refuses an illegal transition', async () => {
      const id = await seedInterview(org.id, interviewer.id, { status: 'COMPLETED' });
      const res = await as(interviewer).post(`/api/interviews/${id}/start`).expect(409);
      expect(res.body.error.message).toMatch(/Cannot move an interview from COMPLETED/);
    });

    it('records a cancellation reason', async () => {
      const id = await seedInterview(org.id, interviewer.id, { status: 'SCHEDULED' });
      const res = await as(interviewer)
        .post(`/api/interviews/${id}/cancel`)
        .send({ reason: 'Candidate withdrew' })
        .expect(200);
      expect(res.body.status).toBe('CANCELLED');

      const stored = await prisma.interview.findUniqueOrThrow({ where: { id } });
      expect(stored.cancelledReason).toBe('Candidate withdrew');
      expect(await auditActions(org.id)).toContain('interview.cancel');
    });

    it('stops a candidate from changing the status', async () => {
      const id = await seedInterview(org.id, interviewer.id, {
        candidateId: candidate.id,
        status: 'SCHEDULED',
      });
      await as(candidate).post(`/api/interviews/${id}/start`).expect(403);
      await as(candidate).post(`/api/interviews/${id}/complete`).expect(403);
    });
  });

  describe('question set', () => {
    it('replaces the question set in order', async () => {
      const second = await seedQuestion(org.id, admin.id, { title: 'Second question' });
      const id = await seedInterview(org.id, interviewer.id, { questionIds: [questionId] });

      const res = await as(interviewer)
        .patch(`/api/interviews/${id}`)
        .send({ questionIds: [second.id, questionId] })
        .expect(200);

      expect((res.body.questions as { questionId: string }[]).map((q) => q.questionId)).toEqual([
        second.id,
        questionId,
      ]);
    });

    it('switches the active question and creates its document', async () => {
      const second = await seedQuestion(org.id, admin.id, { title: 'Second question' });
      const id = await seedInterview(org.id, interviewer.id, {
        questionIds: [questionId, second.id],
      });

      const res = await as(interviewer)
        .post(`/api/interviews/${id}/active-question`)
        .send({ questionId: second.id })
        .expect(200);

      expect(res.body.questionId).toBe(second.id);
      expect(res.body.version).toBe(0);

      const stored = await prisma.interview.findUniqueOrThrow({ where: { id } });
      expect(stored.activeQuestionId).toBe(second.id);
    });

    it('refuses to activate a question that is not attached', async () => {
      const detached = await seedQuestion(org.id, admin.id, { title: 'Detached question' });
      const id = await seedInterview(org.id, interviewer.id, { questionIds: [questionId] });
      await as(interviewer)
        .post(`/api/interviews/${id}/active-question`)
        .send({ questionId: detached.id })
        .expect(400);
    });

    it('stops a candidate from switching the active question', async () => {
      const second = await seedQuestion(org.id, admin.id, { title: 'Second question' });
      const id = await seedInterview(org.id, interviewer.id, {
        questionIds: [questionId, second.id],
        candidateId: candidate.id,
      });
      await as(candidate)
        .post(`/api/interviews/${id}/active-question`)
        .send({ questionId: second.id })
        .expect(403);
    });
  });

  describe('collaborative documents', () => {
    it('creates one document per question, pre-filled with starter code', async () => {
      const id = await seedInterview(org.id, interviewer.id, {
        questionIds: [questionId],
        candidateId: candidate.id,
      });

      const doc = await as(candidate)
        .post(`/api/interviews/${id}/documents`)
        .send({ questionId })
        .expect(200);

      expect(doc.body.content).toContain('solve me');
      expect(doc.body.language).toBe('javascript');
      expect(doc.body.version).toBe(0);
    });

    it('returns the same document on a repeat request', async () => {
      const id = await seedInterview(org.id, interviewer.id, { questionIds: [questionId] });
      const first = await as(interviewer)
        .post(`/api/interviews/${id}/documents`)
        .send({ questionId })
        .expect(200);
      const second = await as(interviewer)
        .post(`/api/interviews/${id}/documents`)
        .send({ questionId })
        .expect(200);
      expect(second.body.documentId).toBe(first.body.documentId);
    });

    it('creates a single scratch document when no question is given', async () => {
      const id = await seedInterview(org.id, interviewer.id, {});
      const first = await as(interviewer)
        .post(`/api/interviews/${id}/documents`)
        .send({ questionId: null })
        .expect(200);
      const second = await as(interviewer)
        .post(`/api/interviews/${id}/documents`)
        .send({})
        .expect(200);

      expect(first.body.questionId).toBeNull();
      expect(second.body.documentId).toBe(first.body.documentId);

      const count = await prisma.codeDocument.count({ where: { interviewId: id, questionId: null } });
      expect(count).toBe(1);
    });

    it('rejects a question that is not part of the interview', async () => {
      const detached = await seedQuestion(org.id, admin.id, { title: 'Detached question' });
      const id = await seedInterview(org.id, interviewer.id, { questionIds: [questionId] });
      await as(interviewer)
        .post(`/api/interviews/${id}/documents`)
        .send({ questionId: detached.id })
        .expect(400);
    });
  });

  describe('participants', () => {
    it('records a join and keeps the first joinedAt', async () => {
      const id = await seedInterview(org.id, interviewer.id, {
        questionIds: [questionId],
        candidateId: candidate.id,
      });

      const res = await as(candidate).post(`/api/interviews/${id}/join`).expect(200);
      expect(res.body.role).toBe('CANDIDATE');
      expect(res.body.isStaff).toBe(false);

      const first = await prisma.interviewParticipant.findFirstOrThrow({
        where: { interviewId: id, userId: candidate.id },
      });
      expect(first.joinedAt).not.toBeNull();

      await as(candidate).post(`/api/interviews/${id}/join`).expect(200);
      const second = await prisma.interviewParticipant.findFirstOrThrow({
        where: { interviewId: id, userId: candidate.id },
      });
      expect(second.joinedAt?.getTime()).toBe(first.joinedAt?.getTime());
      expect(second.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(first.lastSeenAt!.getTime());
      expect(await auditActions(org.id)).toContain('interview.join');
    });

    it('adds and removes a participant', async () => {
      const id = await seedInterview(org.id, interviewer.id, { questionIds: [questionId] });
      await as(interviewer)
        .post(`/api/interviews/${id}/participants`)
        .send({ userId: candidate.id, role: 'CANDIDATE' })
        .expect(201);
      await as(interviewer).delete(`/api/interviews/${id}/participants/${candidate.id}`).expect(204);
      await as(interviewer)
        .delete(`/api/interviews/${id}/participants/${candidate.id}`)
        .expect(404);
    });
  });

  describe('listing and filtering', () => {
    it('filters by status and by assignment', async () => {
      await seedInterview(org.id, interviewer.id, { status: 'DRAFT', title: 'Draft one' });
      await seedInterview(org.id, admin.id, {
        status: 'COMPLETED',
        interviewerIds: [admin.id],
        title: 'Completed one',
      });

      const drafts = await as(interviewer).get('/api/interviews?status=DRAFT').expect(200);
      expect((drafts.body.items as { title: string }[]).map((i) => i.title)).toEqual(['Draft one']);

      const mine = await as(interviewer).get('/api/interviews?mine=true').expect(200);
      const titles = (mine.body.items as { title: string }[]).map((i) => i.title);
      expect(titles).toContain('Draft one');
      expect(titles).not.toContain('Completed one');
    });

    it('searches by title and paginates', async () => {
      for (let i = 0; i < 5; i += 1) {
        await seedInterview(org.id, interviewer.id, { title: `Backend round ${i}` });
      }
      const search = await as(interviewer).get('/api/interviews?search=Backend').expect(200);
      expect(search.body.total).toBe(5);

      const page = await as(interviewer).get('/api/interviews?pageSize=2&page=2').expect(200);
      expect(page.body.items).toHaveLength(2);
      expect(page.body.page).toBe(2);
    });
  });
});
