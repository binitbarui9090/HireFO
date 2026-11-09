import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { unauthorized } from '../lib/errors.js';

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Session id, so a revoked session invalidates its access tokens on refresh. */
  sid: string;
  email: string;
}

const ISSUER = 'hirefo';
const AUDIENCE = 'hirefo-api';

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, config().JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: config().ACCESS_TOKEN_TTL_SECONDS,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, config().JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof decoded === 'string') throw new Error('unexpected token payload');
    const { sub, sid, email } = decoded as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof sid !== 'string' || typeof email !== 'string') {
      throw new Error('missing claims');
    }
    return { sub, sid, email };
  } catch {
    throw unauthorized('Access token is invalid or has expired.');
  }
}

export const REFRESH_COOKIE = 'hirefo_rt';

export function refreshCookieOptions(maxAgeMs: number) {
  const c = config();
  return {
    httpOnly: true as const,
    secure: c.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/api/auth',
    maxAge: maxAgeMs,
    ...(c.COOKIE_DOMAIN ? { domain: c.COOKIE_DOMAIN } : {}),
  };
}
