import { Router } from 'express';
import { z } from 'zod';
import { createInvitationSchema, updateMemberSchema } from '@hirefo/shared';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../lib/async.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { clientIp, parseBody, parseParams, parseQuery, userAgent } from '../lib/http.js';
import { authenticate, orgContext, requireAuth, requireRole, withOrg } from '../middleware/auth.js';
import { createInvitation } from '../services/auth.js';
import { organizationOverview } from '../services/analytics.js';
import { createRubric, listRubrics } from '../services/evaluations.js';
import { createRubricSchema } from '@hirefo/shared';

export const orgRouter = Router();

orgRouter.use(authenticate, withOrg);

const actor = (req: Parameters<Parameters<Router['get']>[1]>[0]) => ({
  userId: requireAuth(req).user.id,
  organizationId: orgContext(req).organizationId,
  ip: clientIp(req),
  userAgent: userAgent(req),
});

orgRouter.get(
  '/current',
  asyncHandler(async (req, res) => {
    const ctx = orgContext(req);
    const org = await prisma.organization.findUnique({ where: { id: ctx.organizationId } });
    if (!org) throw notFound('Organization not found.');
    res.json({ id: org.id, name: org.name, slug: org.slug, yourRole: ctx.role, createdAt: org.createdAt });
  }),
);

orgRouter.get(
  '/overview',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    res.json(await organizationOverview(orgContext(req).organizationId));
  }),
);

orgRouter.get(
  '/members',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const ctx = orgContext(req);
    const members = await prisma.membership.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      include: {
        user: { select: { id: true, name: true, email: true, avatarColor: true, lastLoginAt: true } },
      },
    });
    res.json({
      items: members.map((m) => ({
        membershipId: m.id,
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        avatarColor: m.user.avatarColor,
        role: m.role,
        status: m.status,
        lastLoginAt: m.user.lastLoginAt,
        joinedAt: m.createdAt,
      })),
    });
  }),
);

orgRouter.patch(
  '/members/:userId',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const ctx = orgContext(req);
    const auth = requireAuth(req);
    const { userId } = parseParams(z.object({ userId: z.string().min(8) }), req);
    const { role } = parseBody(updateMemberSchema, req);

    if (userId === auth.user.id && role !== 'ADMIN') {
      throw badRequest('You cannot remove your own admin role.');
    }

    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: ctx.organizationId } },
    });
    if (!membership) throw notFound('That user is not a member of this organization.');

    if (membership.role === 'ADMIN' && role !== 'ADMIN') {
      const admins = await prisma.membership.count({
        where: { organizationId: ctx.organizationId, role: 'ADMIN', status: 'ACTIVE' },
      });
      if (admins <= 1) throw conflict('An organization must keep at least one admin.');
    }

    const updated = await prisma.membership.update({
      where: { id: membership.id },
      data: { role },
    });
    await recordAudit({
      action: 'org.member_role_change',
      organizationId: ctx.organizationId,
      actorId: auth.user.id,
      targetType: 'user',
      targetId: userId,
      metadata: { from: membership.role, to: role },
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    res.json({ userId, role: updated.role });
  }),
);

orgRouter.delete(
  '/members/:userId',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const ctx = orgContext(req);
    const auth = requireAuth(req);
    const { userId } = parseParams(z.object({ userId: z.string().min(8) }), req);
    if (userId === auth.user.id) throw badRequest('You cannot remove yourself.');

    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: ctx.organizationId } },
    });
    if (!membership) throw notFound('That user is not a member of this organization.');

    // Suspend rather than delete: interviews, submissions and audit rows keep
    // pointing at a real user.
    await prisma.membership.update({ where: { id: membership.id }, data: { status: 'SUSPENDED' } });
    await recordAudit({
      action: 'org.member_remove',
      organizationId: ctx.organizationId,
      actorId: auth.user.id,
      targetType: 'user',
      targetId: userId,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    res.status(204).end();
  }),
);

orgRouter.get(
  '/invitations',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const ctx = orgContext(req);
    const invitations = await prisma.invitation.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        createdBy: { select: { id: true, name: true } },
        interview: { select: { id: true, title: true } },
      },
    });
    res.json({
      items: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        interview: i.interview,
        createdBy: i.createdBy,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        acceptedAt: i.acceptedAt,
        revokedAt: i.revokedAt,
        status: i.revokedAt
          ? 'REVOKED'
          : i.acceptedAt
            ? 'ACCEPTED'
            : i.expiresAt <= new Date()
              ? 'EXPIRED'
              : 'PENDING',
      })),
    });
  }),
);

orgRouter.post(
  '/invitations',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const ctx = orgContext(req);
    const input = parseBody(createInvitationSchema, req);

    // Only admins may hand out staff roles.
    if (input.role !== 'CANDIDATE' && ctx.role !== 'ADMIN') {
      throw badRequest('Only admins can invite interviewers or admins.');
    }
    if (input.interviewId) {
      const interview = await prisma.interview.findFirst({
        where: { id: input.interviewId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      if (!interview) throw notFound('Interview not found.');
    }

    const invitation = await createInvitation(
      {
        organizationId: ctx.organizationId,
        createdById: requireAuth(req).user.id,
        email: input.email,
        role: input.role,
        ...(input.interviewId ? { interviewId: input.interviewId } : {}),
        expiresInHours: input.expiresInHours,
      },
      { ip: clientIp(req), userAgent: userAgent(req) },
    );

    // The raw token is returned exactly once, to the inviter, so they can pass the
    // link on. It is stored only as a hash.
    res.status(201).json({
      ...invitation,
      note: 'Copy this link now — it is shown only once. No email is sent; HireFO has no mail transport configured.',
    });
  }),
);

orgRouter.post(
  '/invitations/:id/revoke',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const ctx = orgContext(req);
    const { id } = parseParams(z.object({ id: z.string().min(8) }), req);
    const invitation = await prisma.invitation.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!invitation) throw notFound('Invitation not found.');
    if (invitation.acceptedAt) throw conflict('That invitation has already been accepted.');

    await prisma.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await recordAudit({
      action: 'invitation.revoke',
      organizationId: ctx.organizationId,
      actorId: requireAuth(req).user.id,
      targetType: 'invitation',
      targetId: id,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    res.status(204).end();
  }),
);

orgRouter.get(
  '/rubrics',
  requireRole('INTERVIEWER'),
  asyncHandler(async (req, res) => {
    res.json({ items: await listRubrics(orgContext(req).organizationId) });
  }),
);

orgRouter.post(
  '/rubrics',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = parseBody(createRubricSchema, req);
    res.status(201).json(await createRubric(input, actor(req)));
  }),
);

orgRouter.get(
  '/audit',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const ctx = orgContext(req);
    const filters = parseQuery(
      z.object({
        action: z.string().max(80).optional(),
        targetType: z.string().max(40).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req,
    );

    const where = {
      organizationId: ctx.organizationId,
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.targetType ? { targetType: filters.targetType } : {}),
    };

    const [total, items] = await prisma.$transaction([
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    res.json({ total, page: filters.page, pageSize: filters.pageSize, items });
  }),
);
