import type { NextFunction, Request, Response } from 'express';
import { ROLE_RANK, type OrgRole, type ParticipantRole } from '@hirefo/shared';
import { prisma } from '../db/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { clientIp, userAgent } from '../lib/http.js';
import { verifyAccessToken } from '../services/tokens.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarColor: number;
}

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrgRole;
}

export interface OrgContext {
  organizationId: string;
  role: OrgRole;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: {
      user: AuthenticatedUser;
      sessionId: string;
      memberships: MembershipSummary[];
    };
    org?: OrgContext;
  }
}

/** Header the SPA uses to declare which organization the request applies to. */
export const ORG_HEADER = 'x-hirefo-org';

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') return null;
  return token.trim();
}

/**
 * Verifies the access token, confirms the session is still live, and loads the
 * caller's memberships fresh from the database on every request. Roles are
 * deliberately *not* trusted from the token, so a revoked membership or a
 * downgraded role takes effect immediately instead of at token expiry.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized('Missing bearer token.');
    const claims = verifyAccessToken(token);

    const session = await prisma.session.findUnique({
      where: { id: claims.sid },
      include: {
        user: {
          include: {
            memberships: {
              where: { status: 'ACTIVE' },
              include: { organization: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw unauthorized('Session is no longer valid. Please sign in again.');
    }
    if (session.userId !== claims.sub) throw unauthorized('Token does not match session.');

    req.auth = {
      sessionId: session.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        avatarColor: session.user.avatarColor,
      },
      memberships: session.user.memberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        organizationSlug: m.organization.slug,
        role: m.role,
      })),
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request): NonNullable<Request['auth']> {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/**
 * Resolves the active organization from the `x-hirefo-org` header, falling back
 * to the caller's only membership. Every tenant-scoped query downstream derives
 * its `organizationId` filter from this value — it is never taken from the body.
 */
export async function withOrg(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = requireAuth(req);
    const requested = req.headers[ORG_HEADER];
    const requestedId = Array.isArray(requested) ? requested[0] : requested;

    let membership: MembershipSummary | undefined;
    if (requestedId) {
      membership = auth.memberships.find((m) => m.organizationId === requestedId);
      if (!membership) {
        await recordAudit({
          action: 'access.denied',
          actorId: auth.user.id,
          targetType: 'organization',
          targetId: requestedId,
          metadata: { reason: 'not_a_member', path: req.originalUrl },
          ip: clientIp(req),
          userAgent: userAgent(req),
        });
        throw forbidden('You are not a member of that organization.');
      }
    } else if (auth.memberships.length === 1) {
      membership = auth.memberships[0];
    } else if (auth.memberships.length === 0) {
      throw forbidden('Your account is not active in any organization.');
    } else {
      throw forbidden(
        `You belong to multiple organizations — send the "${ORG_HEADER}" header to choose one.`,
      );
    }

    req.org = { organizationId: membership.organizationId, role: membership.role };
    next();
  } catch (err) {
    next(err);
  }
}

export function orgContext(req: Request): OrgContext {
  if (!req.org) throw forbidden('Organization context is missing.');
  return req.org;
}

/** Enforces a minimum organization role. */
export function requireRole(min: OrgRole) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = orgContext(req);
      if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) {
        await recordAudit({
          action: 'access.denied',
          organizationId: ctx.organizationId,
          actorId: req.auth?.user.id ?? null,
          metadata: { reason: 'insufficient_role', required: min, actual: ctx.role, path: req.originalUrl },
          ip: clientIp(req),
          userAgent: userAgent(req),
        });
        throw forbidden(`This action requires the ${min.toLowerCase()} role.`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export interface InterviewAccess {
  interviewId: string;
  organizationId: string;
  /** Participant role on this interview, if the caller is a participant. */
  participantRole: ParticipantRole | null;
  /** True for org admins/interviewers — they may see private notes and copilot output. */
  isStaff: boolean;
}

/**
 * Loads an interview inside the caller's organization and resolves what they may
 * do with it.
 *
 * - A row belonging to another organization is reported as 404, never 403, so the
 *   API does not confirm that the id exists elsewhere.
 * - Candidates must be listed as participants; org membership alone is not enough.
 */
export async function resolveInterviewAccess(
  req: Request,
  interviewId: string,
  opts: { requireStaff?: boolean } = {},
): Promise<InterviewAccess> {
  const auth = requireAuth(req);
  const ctx = orgContext(req);

  const interview = await prisma.interview.findFirst({
    where: { id: interviewId, organizationId: ctx.organizationId },
    select: { id: true, organizationId: true },
  });
  if (!interview) throw notFound('Interview not found.');

  const participant = await prisma.interviewParticipant.findUnique({
    where: { interviewId_userId: { interviewId, userId: auth.user.id } },
    select: { role: true },
  });

  const isStaff = ctx.role === 'ADMIN' || ctx.role === 'INTERVIEWER';

  if (!isStaff && !participant) {
    await recordAudit({
      action: 'access.denied',
      organizationId: ctx.organizationId,
      actorId: auth.user.id,
      targetType: 'interview',
      targetId: interviewId,
      metadata: { reason: 'not_a_participant', path: req.originalUrl },
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    throw notFound('Interview not found.');
  }

  if (opts.requireStaff && !isStaff) {
    await recordAudit({
      action: 'access.denied',
      organizationId: ctx.organizationId,
      actorId: auth.user.id,
      targetType: 'interview',
      targetId: interviewId,
      metadata: { reason: 'staff_only', path: req.originalUrl },
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    throw forbidden('Only interviewers and admins can perform this action.');
  }

  return {
    interviewId,
    organizationId: interview.organizationId,
    participantRole: participant?.role ?? null,
    isStaff,
  };
}
