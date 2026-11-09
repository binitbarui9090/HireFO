import { Router } from 'express';
import { z } from 'zod';
import {
  acceptInvitationSchema,
  loginSchema,
  registerSchema,
} from '@hirefo/shared';
import { config } from '../config/env.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../lib/async.js';
import { clientIp, parseBody, parseParams, userAgent } from '../lib/http.js';
import { unauthorized } from '../lib/errors.js';
import {
  acceptInvitation,
  login,
  logout,
  previewInvitation,
  refreshSession,
  registerWithOrganization,
  revokeAllSessions,
  type AuthResult,
} from '../services/auth.js';
import { REFRESH_COOKIE, refreshCookieOptions } from '../services/tokens.js';

export const authRouter = Router();

function sendAuth(res: Parameters<Parameters<Router['post']>[1]>[1], auth: AuthResult, extra: object = {}) {
  const maxAge = auth.refreshExpiresAt.getTime() - Date.now();
  res.cookie(REFRESH_COOKIE, auth.refreshToken, refreshCookieOptions(maxAge));
  res.json({
    accessToken: auth.accessToken,
    expiresIn: config().ACCESS_TOKEN_TTL_SECONDS,
    user: auth.user,
    ...extra,
  });
}

const meta = (req: Parameters<Parameters<Router['post']>[1]>[0]) => ({
  ip: clientIp(req),
  userAgent: userAgent(req),
});

authRouter.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(registerSchema, req);
    const result = await registerWithOrganization(input, meta(req));
    sendAuth(res, result, { organizationId: result.organizationId });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(loginSchema, req);
    const result = await login(input, meta(req));
    sendAuth(res, result);
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (typeof token !== 'string' || !token) throw unauthorized('No refresh token present.');
    const result = await refreshSession(token, meta(req));
    sendAuth(res, result);
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    await logout(typeof token === 'string' ? token : undefined, meta(req));
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(0));
    res.status(204).end();
  }),
);

authRouter.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const revoked = await revokeAllSessions(auth.user.id);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(0));
    res.json({ revoked });
  }),
);

authRouter.get(
  '/invitations/:token',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token } = parseParams(z.object({ token: z.string().min(20).max(200) }), req);
    res.json(await previewInvitation(token));
  }),
);

authRouter.post(
  '/invitations/accept',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(acceptInvitationSchema, req);
    const result = await acceptInvitation(input, meta(req));
    sendAuth(res, result, {
      organizationId: result.organizationId,
      interviewId: result.interviewId,
    });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    res.json({ user: auth.user, memberships: auth.memberships });
  }),
);
