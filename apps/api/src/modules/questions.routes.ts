import { Router } from 'express';
import { z } from 'zod';
import {
  createQuestionSchema,
  listQuestionsSchema,
  updateQuestionSchema,
} from '@hirefo/shared';
import { asyncHandler } from '../lib/async.js';
import { clientIp, parseBody, parseParams, parseQuery, userAgent } from '../lib/http.js';
import { authenticate, orgContext, requireAuth, requireRole, withOrg } from '../middleware/auth.js';
import { createQuestion, getQuestion, listQuestions, updateQuestion } from '../services/questions.js';

export const questionRouter = Router();

// The whole question library is interviewer material: a candidate must never be
// able to browse it, and hidden test cases never leave this boundary.
questionRouter.use(authenticate, withOrg, requireRole('INTERVIEWER'));

const idParam = z.object({ id: z.string().min(8).max(64) });

const actor = (req: Parameters<Parameters<Router['get']>[1]>[0]) => ({
  userId: requireAuth(req).user.id,
  organizationId: orgContext(req).organizationId,
  ip: clientIp(req),
  userAgent: userAgent(req),
});

questionRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = parseQuery(listQuestionsSchema, req);
    res.json(await listQuestions(filters, orgContext(req).organizationId));
  }),
);

questionRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseBody(createQuestionSchema, req);
    res.status(201).json(await createQuestion(input, actor(req)));
  }),
);

questionRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    res.json(await getQuestion(id, orgContext(req).organizationId, true));
  }),
);

questionRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    const input = parseBody(updateQuestionSchema, req);
    res.json(await updateQuestion(id, input, actor(req)));
  }),
);

questionRouter.post(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    res.json(await updateQuestion(id, { isArchived: true }, actor(req)));
  }),
);

questionRouter.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const { id } = parseParams(idParam, req);
    res.json(await updateQuestion(id, { isArchived: false }, actor(req)));
  }),
);
