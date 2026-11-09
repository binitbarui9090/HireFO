import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';
import { AppError } from '../lib/errors.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` },
  });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = res.getHeader('x-request-id');

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, requestId }, 'request failed');
    else logger.debug({ err: { code: err.code, message: err.message }, requestId }, 'request rejected');
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'bad_request', message: 'Validation failed.', details: err.flatten() },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        error: {
          code: 'conflict',
          message: 'That value is already taken.',
          details: { target: err.meta?.['target'] ?? null },
        },
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'not_found', message: 'Resource not found.' } });
      return;
    }
    logger.error({ err, requestId }, 'prisma request error');
    res.status(400).json({ error: { code: 'database_error', message: 'The request could not be completed.' } });
    return;
  }

  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'bad_request', message: 'Malformed JSON body.' } });
    return;
  }

  logger.error({ err, requestId, path: req.originalUrl }, 'unhandled error');
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong on our side.' },
  });
}
