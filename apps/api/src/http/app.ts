import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { errorHandler, notFoundHandler } from '../middleware/errors.js';
import { apiLimiter } from '../middleware/rateLimit.js';
import { requestId } from '../middleware/requestContext.js';
import { aiRouter } from '../modules/ai.routes.js';
import { authRouter } from '../modules/auth.routes.js';
import { interviewRouter } from '../modules/interviews.routes.js';
import { metaRouter } from '../modules/meta.routes.js';
import { orgRouter } from '../modules/orgs.routes.js';
import { questionRouter } from '../modules/questions.routes.js';
import { ORG_HEADER } from '../middleware/auth.js';

export function createApp(): Express {
  const cfg = config();
  const app = express();

  if (cfg.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);

  app.use(
    helmet({
      // The API serves JSON only; the SPA is served separately, so a restrictive
      // default CSP here costs nothing.
      contentSecurityPolicy: {
        directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin and non-browser clients send no Origin header.
        if (!origin) return callback(null, true);
        if (cfg.webOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed.`));
      },
      credentials: true,
      allowedHeaders: ['content-type', 'authorization', ORG_HEADER, 'x-request-id'],
      exposedHeaders: ['x-request-id'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  if (!cfg.isTest) {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/api/livez' },
        customLogLevel: (_req, res, err) =>
          err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      }),
    );
  }

  app.use('/api', metaRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/org', apiLimiter, orgRouter);
  app.use('/api/questions', apiLimiter, questionRouter);
  app.use('/api/interviews', apiLimiter, interviewRouter);
  app.use('/api/ai', apiLimiter, aiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
