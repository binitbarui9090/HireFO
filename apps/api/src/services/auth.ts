import type { OrgRole } from '@hirefo/shared';
import { config } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { conflict, forbidden, unauthorized } from '../lib/errors.js';
import { generateToken, hashToken, slugify } from '../lib/ids.js';
import { burnPasswordTime, hashPassword, verifyPassword } from './passwords.js';
import { signAccessToken } from './tokens.js';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: { id: string; email: string; name: string; avatarColor: number };
}

const AVATAR_COLORS = 6;

function refreshExpiry(): Date {
  return new Date(Date.now() + config().REFRESH_TOKEN_TTL_DAYS * 86_400_000);
}

async function issueSession(
  user: { id: string; email: string; name: string; avatarColor: number },
  meta: RequestMeta,
): Promise<AuthResult> {
  const refreshToken = generateToken(48);
  const expiresAt = refreshExpiry();
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    },
  });
  return {
    accessToken: signAccessToken({ sub: user.id, sid: session.id, email: user.email }),
    refreshToken,
    refreshExpiresAt: expiresAt,
    user,
  };
}

/** Finds a free org slug, appending -2, -3 ... on collision. */
async function uniqueOrgSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await prisma.organization.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
  }
  return `${base}-${generateToken(4).toLowerCase()}`;
}

export async function registerWithOrganization(
  input: { name: string; email: string; password: string; organizationName: string },
  meta: RequestMeta,
): Promise<AuthResult & { organizationId: string }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    // Don't leak which addresses are registered beyond what signup inherently reveals.
    throw conflict('An account with that email already exists. Try signing in instead.');
  }
  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueOrgSlug(input.organizationName);

  const { user, organization } = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        avatarColor: Math.floor(Math.random() * AVATAR_COLORS),
      },
    });
    const createdOrg = await tx.organization.create({
      data: { name: input.organizationName, slug },
    });
    await tx.membership.create({
      data: {
        userId: createdUser.id,
        organizationId: createdOrg.id,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    await tx.evaluationRubric.create({
      data: {
        organizationId: createdOrg.id,
        name: 'Default technical rubric',
        description: 'Starting point. Admins can edit or add rubrics.',
        isDefault: true,
        criteria: [
          { key: 'problem_solving', label: 'Problem solving', maxScore: 5, description: 'Decomposition, trade-offs, recovery from dead ends.' },
          { key: 'coding', label: 'Coding & correctness', maxScore: 5, description: 'Clarity, correctness, handling of edge cases.' },
          { key: 'debugging', label: 'Debugging', maxScore: 5, description: 'Reads failures, forms hypotheses, verifies.' },
          { key: 'communication', label: 'Communication', maxScore: 5, description: 'Explains reasoning, responds to feedback.' },
          { key: 'depth', label: 'Technical depth', maxScore: 5, description: 'Understanding beneath the surface API.' },
        ],
      },
    });
    await recordAudit(
      {
        action: 'auth.register',
        organizationId: createdOrg.id,
        actorId: createdUser.id,
        targetType: 'user',
        targetId: createdUser.id,
        metadata: { organizationName: createdOrg.name },
        ...meta,
      },
      tx,
    );
    return { user: createdUser, organization: createdOrg };
  });

  const auth = await issueSession(
    { id: user.id, email: user.email, name: user.name, avatarColor: user.avatarColor },
    meta,
  );
  return { ...auth, organizationId: organization.id };
}

export async function login(
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.passwordHash) {
    await burnPasswordTime(input.password);
    await recordAudit({
      action: 'auth.login_failed',
      metadata: { email: input.email, reason: 'no_account' },
      ...meta,
    });
    throw unauthorized('Email or password is incorrect.');
  }
  // Resolved before the password check so a failed attempt can be attributed to
  // the user's organization — an admin needs to see failed logins against their
  // own org in the audit log, not just in the process logs.
  const activeMembership = await prisma.membership.findFirst({
    where: { userId: user.id, status: 'ACTIVE' },
  });

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    await recordAudit({
      action: 'auth.login_failed',
      organizationId: activeMembership?.organizationId ?? null,
      actorId: user.id,
      metadata: { reason: 'bad_password' },
      ...meta,
    });
    throw unauthorized('Email or password is incorrect.');
  }
  if (!activeMembership) {
    await recordAudit({
      action: 'auth.login_failed',
      actorId: user.id,
      metadata: { reason: 'no_active_membership' },
      ...meta,
    });
    throw forbidden('Your account is not active in any organization. Contact an administrator.');
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const auth = await issueSession(
    { id: user.id, email: user.email, name: user.name, avatarColor: user.avatarColor },
    meta,
  );
  await recordAudit({
    action: 'auth.login',
    organizationId: activeMembership.organizationId,
    actorId: user.id,
    ...meta,
  });
  return auth;
}

export async function refreshSession(token: string, meta: RequestMeta): Promise<AuthResult> {
  const hash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hash },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw unauthorized('Session has expired. Please sign in again.');
  }

  // Rotate: the presented token is retired and a fresh one is issued.
  const refreshToken = generateToken(48);
  const expiresAt = refreshExpiry();
  const rotated = await prisma.$transaction(async (tx) => {
    await tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return tx.session.create({
      data: {
        userId: session.userId,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      },
    });
  });

  return {
    accessToken: signAccessToken({
      sub: session.userId,
      sid: rotated.id,
      email: session.user.email,
    }),
    refreshToken,
    refreshExpiresAt: expiresAt,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      avatarColor: session.user.avatarColor,
    },
  };
}

export async function logout(token: string | undefined, meta: RequestMeta): Promise<void> {
  if (!token) return;
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hashToken(token) } });
  if (!session || session.revokedAt) return;
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  await recordAudit({ action: 'auth.logout', actorId: session.userId, ...meta });
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

export interface InvitationLink {
  invitationId: string;
  email: string;
  role: OrgRole;
  token: string;
  url: string;
  expiresAt: Date;
}

export async function createInvitation(
  params: {
    organizationId: string;
    createdById: string;
    email: string;
    role: OrgRole;
    interviewId?: string;
    expiresInHours: number;
  },
  meta: RequestMeta,
): Promise<InvitationLink> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + params.expiresInHours * 3_600_000);

  const invitation = await prisma.invitation.create({
    data: {
      organizationId: params.organizationId,
      createdById: params.createdById,
      email: params.email,
      role: params.role,
      interviewId: params.interviewId ?? null,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });

  await recordAudit({
    action: 'invitation.create',
    organizationId: params.organizationId,
    actorId: params.createdById,
    targetType: 'invitation',
    targetId: invitation.id,
    metadata: { email: params.email, role: params.role, interviewId: params.interviewId ?? null },
    ...meta,
  });

  return {
    invitationId: invitation.id,
    email: params.email,
    role: params.role,
    token,
    url: `${config().WEB_PUBLIC_URL.replace(/\/$/, '')}/invite/${token}`,
    expiresAt,
  };
}

export interface InvitationPreview {
  email: string;
  role: OrgRole;
  organizationName: string;
  interviewTitle: string | null;
  requiresPassword: boolean;
  expiresAt: Date;
}

async function loadLiveInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: true, interview: true },
  });
  if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
    throw unauthorized('This invitation link is no longer valid.');
  }
  if (invitation.expiresAt <= new Date()) throw unauthorized('This invitation link has expired.');
  return invitation;
}

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const invitation = await loadLiveInvitation(token);
  const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });
  return {
    email: invitation.email,
    role: invitation.role,
    organizationName: invitation.organization.name,
    interviewTitle: invitation.interview?.title ?? null,
    requiresPassword: !existingUser?.passwordHash,
    expiresAt: invitation.expiresAt,
  };
}

export async function acceptInvitation(
  input: { token: string; name?: string; password?: string },
  meta: RequestMeta,
): Promise<AuthResult & { organizationId: string; interviewId: string | null }> {
  const invitation = await loadLiveInvitation(input.token);

  const user = await prisma.$transaction(async (tx) => {
    let target = await tx.user.findUnique({ where: { email: invitation.email } });

    if (!target) {
      if (!input.password) {
        throw forbidden('A password is required to create your account.');
      }
      target = await tx.user.create({
        data: {
          email: invitation.email,
          name: input.name?.trim() || invitation.email.split('@')[0]!,
          passwordHash: await hashPassword(input.password),
          avatarColor: Math.floor(Math.random() * AVATAR_COLORS),
        },
      });
    } else if (!target.passwordHash) {
      if (!input.password) throw forbidden('A password is required to finish setting up your account.');
      target = await tx.user.update({
        where: { id: target.id },
        data: {
          passwordHash: await hashPassword(input.password),
          name: input.name?.trim() || target.name,
        },
      });
    }

    await tx.membership.upsert({
      where: { userId_organizationId: { userId: target.id, organizationId: invitation.organizationId } },
      create: {
        userId: target.id,
        organizationId: invitation.organizationId,
        role: invitation.role,
        status: 'ACTIVE',
      },
      update: { status: 'ACTIVE' },
    });

    if (invitation.interviewId) {
      await tx.interviewParticipant.upsert({
        where: {
          interviewId_userId: { interviewId: invitation.interviewId, userId: target.id },
        },
        create: {
          interviewId: invitation.interviewId,
          userId: target.id,
          role: invitation.role === 'CANDIDATE' ? 'CANDIDATE' : 'INTERVIEWER',
        },
        update: {},
      });
    }

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });

    await recordAudit(
      {
        action: 'invitation.accept',
        organizationId: invitation.organizationId,
        actorId: target.id,
        targetType: 'invitation',
        targetId: invitation.id,
        metadata: { role: invitation.role, interviewId: invitation.interviewId },
        ...meta,
      },
      tx,
    );

    return target;
  });

  const auth = await issueSession(
    { id: user.id, email: user.email, name: user.name, avatarColor: user.avatarColor },
    meta,
  );
  return { ...auth, organizationId: invitation.organizationId, interviewId: invitation.interviewId };
}
