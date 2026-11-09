import { Router } from 'express';
import { z } from 'zod';
import {
  addParticipantSchema,
  createInterviewSchema,
  createNoteSchema,
  createSubmissionSchema,
  listInterviewsSchema,
  saveEvaluationSchema,
  updateInterviewSchema,
  updateNoteSchema,
} from '@hirefo/shared';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../lib/async.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { clientIp, parseBody, parseParams, parseQuery, userAgent } from '../lib/http.js';
import {
  authenticate,
  orgContext,
  requireAuth,
  requireRole,
  resolveInterviewAccess,
  withOrg,
} from '../middleware/auth.js';
import { executionLimiter } from '../middleware/rateLimit.js';
import { interviewAnalytics } from '../services/analytics.js';
import { ensureDocument, listDocuments, setActiveQuestion } from '../services/documents.js';
import { listEvaluations, saveEvaluation } from '../services/evaluations.js';
import { createSubmission, getExecution, listExecutionHistory } from '../services/executions.js';
import {
  createInterview,
  getInterview,
  listInterviews,
  markParticipantJoined,
  updateInterview,
} from '../services/interviews.js';
import { createNote, deleteNote, listNotes, updateNote } from '../services/notes.js';

export const interviewRouter = Router();

interviewRouter.use(authenticate, withOrg);

const idParam = z.object({ id: z.string().min(8).max(64) });

const actor = (req: Parameters<Parameters<Router['get']>[1]>[0]) => ({
  userId: requireAuth(req).user.id,
  organizationId: orgContext(req).organizationId,
  ip: clientIp(req),
  userAgent: userAgent(req),
});

// --- listing & creation ----------------------------------------------------

interviewRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = orgContext(req);
    const filters = parseQuery(listInterviewsSchema, req);
    // Candidates are restricted to interviews they participate in.
    const restrict = ctx.role === 'CANDIDATE';
    res.json(await listInterviews(filters, actor(req), restrict));
  }),
);

interviewRouter.post(
  '/',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const input = parseBody(createInterviewSchema, req);
    res.status(201).json(await createInterview(input, actor(req)));
  }),
);

// --- single interview ------------------------------------------------------

interviewRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    const access = await resolveInterviewAccess(req, id);
    res.json({
      ...(await getInterview(id, access.organizationId, access.isStaff)),
      yourRole: access.participantRole,
      isStaff: access.isStaff,
    });
  }),
);

interviewRouter.patch(
  '/:id',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    const input = parseBody(updateInterviewSchema, req);
    res.json(await updateInterview(id, input, actor(req)));
  }),
);

interviewRouter.post(
  '/:id/start',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    res.json(await updateInterview(id, { status: 'IN_PROGRESS' }, actor(req)));
  }),
);

interviewRouter.post(
  '/:id/complete',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    res.json(await updateInterview(id, { status: 'COMPLETED' }, actor(req)));
  }),
);

interviewRouter.post(
  '/:id/cancel',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    const { reason } = parseBody(z.object({ reason: z.string().trim().max(500).optional() }), req);
    const updated = await updateInterview(id, { status: 'CANCELLED' }, actor(req));
    if (reason) {
      await prisma.interview.update({ where: { id }, data: { cancelledReason: reason } });
    }
    res.json({ ...updated, cancelledReason: reason ?? null });
  }),
);

/** Called by a participant when they open the workspace. */
interviewRouter.post(
  '/:id/join',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    const access = await resolveInterviewAccess(req, id);
    await markParticipantJoined(id, requireAuth(req).user.id);
    await recordAudit({
      action: 'interview.join',
      organizationId: access.organizationId,
      actorId: requireAuth(req).user.id,
      targetType: 'interview',
      targetId: id,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    res.json({ ok: true, role: access.participantRole, isStaff: access.isStaff });
  }),
);

interviewRouter.post(
  '/:id/participants',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    const ctx = orgContext(req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    const input = parseBody(addParticipantSchema, req);

    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: input.userId, organizationId: ctx.organizationId } },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw badRequest('That user is not an active member of this organization.');
    }

    const participant = await prisma.interviewParticipant.upsert({
      where: { interviewId_userId: { interviewId: id, userId: input.userId } },
      create: { interviewId: id, userId: input.userId, role: input.role },
      update: { role: input.role },
      include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } },
    });
    res.status(201).json(participant);
  }),
);

interviewRouter.delete(
  '/:id/participants/:userId',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id, userId } = parseParams(
      idParam.extend({ userId: z.string().min(8).max(64) }),
      req,
    );
    await resolveInterviewAccess(req, id, { requireStaff: true });
    const deleted = await prisma.interviewParticipant.deleteMany({
      where: { interviewId: id, userId },
    });
    if (deleted.count === 0) throw notFound('That user is not a participant.');
    res.status(204).end();
  }),
);

// --- collaborative documents ----------------------------------------------

interviewRouter.get(
  '/:id/documents',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id);
    res.json({ items: await listDocuments(id) });
  }),
);

interviewRouter.post(
  '/:id/documents',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id);
    const { questionId } = parseBody(
      z.object({ questionId: z.string().min(8).max(64).nullable().default(null) }),
      req,
    );
    res.json(await ensureDocument(id, questionId));
  }),
);

interviewRouter.post(
  '/:id/active-question',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    const { questionId } = parseBody(z.object({ questionId: z.string().min(8).max(64) }), req);
    res.json(await setActiveQuestion(id, questionId));
  }),
);

// --- submissions & execution ----------------------------------------------

interviewRouter.post(
  '/:id/submissions',
  executionLimiter,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    const access = await resolveInterviewAccess(req, id);
    const input = parseBody(createSubmissionSchema, req);

    const interview = await prisma.interview.findUnique({
      where: { id },
      select: { status: true },
    });
    if (interview && ['COMPLETED', 'CANCELLED'].includes(interview.status)) {
      throw badRequest(`Code cannot be run on a ${interview.status.toLowerCase()} interview.`);
    }

    const result = await createSubmission(input, {
      interviewId: id,
      organizationId: access.organizationId,
      userId: requireAuth(req).user.id,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    res.status(202).json(result);
  }),
);

interviewRouter.get(
  '/:id/executions',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id);
    res.json({ items: await listExecutionHistory(id) });
  }),
);

interviewRouter.get(
  '/:id/executions/:executionId',
  asyncHandler(async (req, res) => {
    const { id, executionId } = parseParams(
      idParam.extend({ executionId: z.string().min(8).max(64) }),
      req,
    );
    const access = await resolveInterviewAccess(req, id);
    // Only staff see hidden test case contents.
    res.json(await getExecution(executionId, access.organizationId, access.isStaff));
  }),
);

// --- notes ----------------------------------------------------------------

interviewRouter.get(
  '/:id/notes',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    const access = await resolveInterviewAccess(req, id);
    res.json({ items: await listNotes(id, access.isStaff) });
  }),
);

interviewRouter.post(
  '/:id/notes',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    const input = parseBody(createNoteSchema, req);
    res.status(201).json(await createNote(id, input, actor(req)));
  }),
);

interviewRouter.patch(
  '/:id/notes/:noteId',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id, noteId } = parseParams(idParam.extend({ noteId: z.string().min(8).max(64) }), req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    const input = parseBody(updateNoteSchema, req);
    res.json(await updateNote(noteId, input, actor(req)));
  }),
);

interviewRouter.delete(
  '/:id/notes/:noteId',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id, noteId } = parseParams(idParam.extend({ noteId: z.string().min(8).max(64) }), req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    await deleteNote(noteId, actor(req));
    res.status(204).end();
  }),
);

// --- evaluation & analytics -----------------------------------------------

interviewRouter.get(
  '/:id/analytics',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    const access = await resolveInterviewAccess(req, id, { requireStaff: true });
    res.json(await interviewAnalytics(id, access.organizationId));
  }),
);

interviewRouter.get(
  '/:id/evaluations',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    res.json({ items: await listEvaluations(id) });
  }),
);

interviewRouter.put(
  '/:id/evaluation',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    await resolveInterviewAccess(req, id, { requireStaff: true });
    const input = parseBody(saveEvaluationSchema, req);
    res.json(await saveEvaluation(id, input, actor(req)));
  }),
);
