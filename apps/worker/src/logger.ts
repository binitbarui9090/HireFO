import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config().LOG_LEVEL,
  base: { service: 'hirefo-worker' },
  // Candidate source is never logged; only sizes and ids.
  redact: { paths: ['code', '*.code', 'source', '*.source'], censor: '[redacted]' },
});
