/**
 * Vitest global setup.
 *
 * Guards against ever pointing the suite at a non-test database: the tests
 * truncate tables, so a misconfigured DATABASE_URL would destroy real data.
 */
import { afterAll, beforeAll } from 'vitest';

beforeAll(() => {
  const url = process.env['DATABASE_URL'] ?? '';
  if (process.env['NODE_ENV'] !== 'test') {
    throw new Error(
      `Refusing to run the suite with NODE_ENV="${process.env['NODE_ENV']}". ` +
        'Run it via "npm run test -w @hirefo/api", which loads .env.test.',
    );
  }
  if (!/test/i.test(url)) {
    throw new Error(
      'DATABASE_URL does not look like a test database (its name must contain "test"). ' +
        `Got: ${url.replace(/:\/\/[^@]*@/, '://***@')}`,
    );
  }
  // The local runner is the only one guaranteed to work without Docker, and the
  // execution path itself is covered by the worker's own suite.
  if (process.env['EXECUTION_RUNNER'] !== 'LOCAL_SUBPROCESS') {
    process.env['EXECUTION_RUNNER'] = 'LOCAL_SUBPROCESS';
  }
  process.env['JWT_ACCESS_SECRET'] ??= 'test-access-secret-at-least-32-characters-long';
  process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-secret-at-least-32-characters-long';
});

// The Prisma client is a module singleton shared by every suite in this file's
// worker. Disconnecting it here, once, keeps individual suites from closing a
// connection another suite is about to use.
afterAll(async () => {
  const { prisma } = await import('../db/prisma.js');
  await prisma.$disconnect().catch(() => undefined);
});
