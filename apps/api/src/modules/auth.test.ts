import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../db/prisma.js';
import { hashToken } from '../lib/ids.js';
import {
  addMember,
  app,
  as,
  auditActions,
  createOrgWithAdmin,
  resetDatabase,
  TEST_PASSWORD,
} from '../test/helpers.js';

describe('authentication', () => {
  beforeEach(resetDatabase);

  describe('registration', () => {
    it('creates the user, the organization, an admin membership and a default rubric', async () => {
      const res = await request(app())
        .post('/api/auth/register')
        .send({
          name: 'Dana Okafor',
          email: 'dana@acme.test',
          password: TEST_PASSWORD,
          organizationName: 'Acme Engineering',
        })
        .expect(200);

      expect(res.body.accessToken).toBeTypeOf('string');
      expect(res.body.user.email).toBe('dana@acme.test');

      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId: res.body.organizationId as string },
      });
      expect(membership.role).toBe('ADMIN');
      expect(membership.status).toBe('ACTIVE');

      const rubric = await prisma.evaluationRubric.findFirstOrThrow({
        where: { organizationId: res.body.organizationId as string },
      });
      expect(rubric.isDefault).toBe(true);
      expect(Array.isArray(rubric.criteria)).toBe(true);
    });

    it('sets an httpOnly refresh cookie scoped to /api/auth', async () => {
      const res = await request(app())
        .post('/api/auth/register')
        .send({
          name: 'A',
          email: 'cookie@acme.test',
          password: TEST_PASSWORD,
          organizationName: 'Cookie Co',
        })
        .expect(200);

      const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
      expect(cookie).toContain('hirefo_rt=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/api/auth');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('never stores the password in plain text', async () => {
      await request(app())
        .post('/api/auth/register')
        .send({
          name: 'A',
          email: 'hash@acme.test',
          password: TEST_PASSWORD,
          organizationName: 'Hash Co',
        })
        .expect(200);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'hash@acme.test' } });
      expect(user.passwordHash).not.toBe(TEST_PASSWORD);
      expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    });

    it('rejects a weak password with a field-level message', async () => {
      const res = await request(app())
        .post('/api/auth/register')
        .send({ name: 'A', email: 'weak@acme.test', password: 'short', organizationName: 'X Co' })
        .expect(400);

      expect(res.body.error.code).toBe('bad_request');
      expect(res.body.error.details.password[0]).toMatch(/12 characters/);
    });

    it('rejects a duplicate email with 409', async () => {
      await createOrgWithAdmin('First Co', 'dup@acme.test');
      const res = await request(app())
        .post('/api/auth/register')
        .send({ name: 'B', email: 'dup@acme.test', password: TEST_PASSWORD, organizationName: 'Second Co' })
        .expect(409);
      expect(res.body.error.code).toBe('conflict');
    });

    it('gives colliding organization names distinct slugs', async () => {
      await createOrgWithAdmin('Same Name', 'a@acme.test');
      await createOrgWithAdmin('Same Name', 'b@acme.test');
      const orgs = await prisma.organization.findMany({ where: { name: 'Same Name' } });
      expect(orgs).toHaveLength(2);
      expect(new Set(orgs.map((o) => o.slug)).size).toBe(2);
    });
  });

  describe('login', () => {
    it('issues a token for correct credentials', async () => {
      await createOrgWithAdmin('Acme', 'login@acme.test');
      const res = await request(app())
        .post('/api/auth/login')
        .send({ email: 'login@acme.test', password: TEST_PASSWORD })
        .expect(200);
      expect(res.body.accessToken).toBeTypeOf('string');
      expect(res.body.expiresIn).toBeGreaterThan(0);
    });

    it('rejects a wrong password and does not reveal that the account exists', async () => {
      await createOrgWithAdmin('Acme', 'real@acme.test');

      const wrongPassword = await request(app())
        .post('/api/auth/login')
        .send({ email: 'real@acme.test', password: 'definitely-wrong-123' })
        .expect(401);
      const unknownEmail = await request(app())
        .post('/api/auth/login')
        .send({ email: 'nobody@acme.test', password: 'definitely-wrong-123' })
        .expect(401);

      expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    });

    it('records a failed login against the user organization so admins can see it', async () => {
      const { org } = await createOrgWithAdmin('Acme', 'audit@acme.test');
      await request(app())
        .post('/api/auth/login')
        .send({ email: 'audit@acme.test', password: 'definitely-wrong-123' })
        .expect(401);

      expect(await auditActions(org.id)).toContain('auth.login_failed');
    });

    it('refuses a user with no active membership', async () => {
      const { org, admin } = await createOrgWithAdmin('Acme', 'admin@acme.test');
      const member = await addMember(org.id, 'suspended@acme.test', 'INTERVIEWER');
      await prisma.membership.updateMany({
        where: { userId: member.id, organizationId: org.id },
        data: { status: 'SUSPENDED' },
      });
      void admin;

      const res = await request(app())
        .post('/api/auth/login')
        .send({ email: 'suspended@acme.test', password: TEST_PASSWORD })
        .expect(403);
      expect(res.body.error.message).toMatch(/not active in any organization/);
    });
  });

  describe('access tokens and sessions', () => {
    it('rejects a request with no token', async () => {
      await request(app()).get('/api/interviews').expect(401);
    });

    it('rejects a malformed or tampered token', async () => {
      await request(app())
        .get('/api/interviews')
        .set('authorization', 'Bearer not.a.jwt')
        .expect(401);

      const { admin } = await createOrgWithAdmin('Acme', 'tamper@acme.test');
      const tampered = `${admin.token.slice(0, -4)}AAAA`;
      await request(app()).get('/api/interviews').set('authorization', `Bearer ${tampered}`).expect(401);
    });

    it('stops accepting a token once its session is revoked', async () => {
      const { admin } = await createOrgWithAdmin('Acme', 'revoke@acme.test');
      await as(admin).get('/api/interviews').expect(200);

      await prisma.session.updateMany({
        where: { userId: admin.id },
        data: { revokedAt: new Date() },
      });

      // Revocation takes effect immediately, not at token expiry.
      await as(admin).get('/api/interviews').expect(401);
    });

    it('reflects a role downgrade immediately, without needing a new token', async () => {
      const { org, admin } = await createOrgWithAdmin('Acme', 'downgrade@acme.test');
      await as(admin).get('/api/questions').expect(200);

      await prisma.membership.updateMany({
        where: { userId: admin.id, organizationId: org.id },
        data: { role: 'CANDIDATE' },
      });

      // The role is read from the database on every request, never from the token.
      await as(admin).get('/api/questions').expect(403);
    });

    it('rotates the refresh token and retires the old one', async () => {
      const agent = request.agent(app());
      await agent
        .post('/api/auth/register')
        .send({
          name: 'A',
          email: 'rotate@acme.test',
          password: TEST_PASSWORD,
          organizationName: 'Rotate Co',
        })
        .expect(200);

      const first = await agent.post('/api/auth/refresh').expect(200);
      expect(first.body.accessToken).toBeTypeOf('string');

      const sessions = await prisma.session.findMany({
        where: { user: { email: 'rotate@acme.test' } },
        orderBy: { createdAt: 'asc' },
      });
      expect(sessions).toHaveLength(2);
      expect(sessions[0]!.revokedAt).not.toBeNull();
      expect(sessions[1]!.revokedAt).toBeNull();
    });

    it('rejects a refresh with no cookie', async () => {
      await request(app()).post('/api/auth/refresh').expect(401);
    });

    it('revokes the session on logout', async () => {
      const agent = request.agent(app());
      await agent
        .post('/api/auth/register')
        .send({
          name: 'A',
          email: 'logout@acme.test',
          password: TEST_PASSWORD,
          organizationName: 'Logout Co',
        })
        .expect(200);

      await agent.post('/api/auth/logout').expect(204);
      await agent.post('/api/auth/refresh').expect(401);
    });
  });

  describe('invitations', () => {
    it('returns the raw token exactly once and stores only its hash', async () => {
      const { admin } = await createOrgWithAdmin('Acme', 'inviter@acme.test');

      const res = await as(admin)
        .post('/api/org/invitations')
        .send({ email: 'newbie@acme.test', role: 'CANDIDATE' })
        .expect(201);

      expect(res.body.token).toBeTypeOf('string');
      expect(res.body.url).toContain(res.body.token);

      const stored = await prisma.invitation.findUniqueOrThrow({
        where: { id: res.body.invitationId as string },
      });
      expect(stored.tokenHash).toBe(hashToken(res.body.token as string));
      expect(stored.tokenHash).not.toBe(res.body.token);

      // The listing never exposes the token again.
      const list = await as(admin).get('/api/org/invitations').expect(200);
      expect(JSON.stringify(list.body)).not.toContain(res.body.token);
    });

    it('lets a candidate accept, creating their account and membership', async () => {
      const { org, admin } = await createOrgWithAdmin('Acme', 'inviter2@acme.test');
      const interviewId = await (async () => {
        const q = await as(admin)
          .post('/api/questions')
          .send({
            title: 'Echo the input',
            description: 'Describe the task here.',
            difficulty: 'EASY',
            categories: ['ALGORITHMS'],
            languages: ['javascript'],
          })
          .expect(201);
        const iv = await as(admin)
          .post('/api/interviews')
          .send({ title: 'Round', language: 'javascript', questionIds: [q.body.id] })
          .expect(201);
        return iv.body.id as string;
      })();

      const invite = await as(admin)
        .post('/api/org/invitations')
        .send({ email: 'candidate@acme.test', role: 'CANDIDATE', interviewId })
        .expect(201);

      const preview = await request(app())
        .get(`/api/auth/invitations/${invite.body.token}`)
        .expect(200);
      expect(preview.body.email).toBe('candidate@acme.test');
      expect(preview.body.requiresPassword).toBe(true);
      expect(preview.body.interviewTitle).toBe('Round');

      const accepted = await request(app())
        .post('/api/auth/invitations/accept')
        .send({ token: invite.body.token, name: 'Jules Tan', password: TEST_PASSWORD })
        .expect(200);

      expect(accepted.body.interviewId).toBe(interviewId);
      const membership = await prisma.membership.findFirstOrThrow({
        where: { organizationId: org.id, user: { email: 'candidate@acme.test' } },
      });
      expect(membership.role).toBe('CANDIDATE');

      const participant = await prisma.interviewParticipant.findFirstOrThrow({
        where: { interviewId, user: { email: 'candidate@acme.test' } },
      });
      expect(participant.role).toBe('CANDIDATE');
    });

    it('cannot be accepted twice', async () => {
      const { admin } = await createOrgWithAdmin('Acme', 'inviter3@acme.test');
      const invite = await as(admin)
        .post('/api/org/invitations')
        .send({ email: 'once@acme.test', role: 'CANDIDATE' })
        .expect(201);

      await request(app())
        .post('/api/auth/invitations/accept')
        .send({ token: invite.body.token, name: 'Once', password: TEST_PASSWORD })
        .expect(200);

      await request(app())
        .post('/api/auth/invitations/accept')
        .send({ token: invite.body.token, name: 'Twice', password: TEST_PASSWORD })
        .expect(401);
    });

    it('rejects an expired invitation', async () => {
      const { admin } = await createOrgWithAdmin('Acme', 'inviter4@acme.test');
      const invite = await as(admin)
        .post('/api/org/invitations')
        .send({ email: 'expired@acme.test', role: 'CANDIDATE' })
        .expect(201);

      await prisma.invitation.update({
        where: { id: invite.body.invitationId as string },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await request(app()).get(`/api/auth/invitations/${invite.body.token}`).expect(401);
    });

    it('rejects a revoked invitation', async () => {
      const { admin } = await createOrgWithAdmin('Acme', 'inviter5@acme.test');
      const invite = await as(admin)
        .post('/api/org/invitations')
        .send({ email: 'revoked@acme.test', role: 'CANDIDATE' })
        .expect(201);

      await as(admin)
        .post(`/api/org/invitations/${invite.body.invitationId}/revoke`)
        .expect(204);

      await request(app()).get(`/api/auth/invitations/${invite.body.token}`).expect(401);
    });

    it('stops a non-admin interviewer from minting staff invitations', async () => {
      const { org, admin } = await createOrgWithAdmin('Acme', 'admin2@acme.test');
      const interviewer = await addMember(org.id, 'iv@acme.test', 'INTERVIEWER');
      void admin;

      await as(interviewer)
        .post('/api/org/invitations')
        .send({ email: 'candidate2@acme.test', role: 'CANDIDATE' })
        .expect(201);

      const res = await as(interviewer)
        .post('/api/org/invitations')
        .send({ email: 'sneaky@acme.test', role: 'ADMIN' })
        .expect(400);
      expect(res.body.error.message).toMatch(/Only admins can invite/);
    });
  });
});
