import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the real stack: Postgres, Redis, the API, the
 * execution worker and the Vite dev server. `npm run test:e2e` assumes the
 * datastores are already up (`npm run infra:up`) and starts the three app
 * processes itself.
 */
const API_PORT = 4100;
const WEB_PORT = 5273;

export default defineConfig({
  testDir: './e2e',
  // Real code execution in containers is not fast; give each journey room.
  timeout: 360_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // The API and the worker run under one `concurrently` command on purpose.
      // Playwright identifies a webServer by its port, and the worker has none —
      // given as a separate entry sharing the API's port it would be silently
      // skipped as "already running", and every execution would hang at RUNNING.
      command:
        'npm exec --workspace @hirefo/api -- prisma migrate deploy && ' +
        'npx concurrently --kill-others-on-fail -n api,worker -c blue,magenta ' +
        '"npm exec --workspace @hirefo/api -- tsx src/server.ts" ' +
        '"npm exec --workspace @hirefo/worker -- tsx src/main.ts"',
      cwd: '../..',
      port: API_PORT,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        HOST: '127.0.0.1',
        LOG_LEVEL: 'warn',
        // A dedicated database and Redis db index, so an e2e run never disturbs
        // the development data.
        DATABASE_URL:
          process.env['E2E_DATABASE_URL'] ??
          'postgresql://hirefo:hirefo@127.0.0.1:55439/hirefo_e2e?schema=public',
        REDIS_URL: process.env['E2E_REDIS_URL'] ?? 'redis://127.0.0.1:56389/2',
        EXECUTION_QUEUE_NAME: 'hirefo-e2e',
        EXECUTION_CONCURRENCY: '2',
        EXECUTION_RUNNER: process.env['E2E_EXECUTION_RUNNER'] ?? 'DOCKER',
        WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
        WEB_PUBLIC_URL: `http://127.0.0.1:${WEB_PORT}`,
        JWT_ACCESS_SECRET: 'e2e-access-secret-at-least-32-characters-long',
        JWT_REFRESH_SECRET: 'e2e-refresh-secret-at-least-32-characters-long',
        COOKIE_SECURE: 'false',
        AI_PROVIDER: 'disabled',
      },
    },
    {
      // --host 127.0.0.1 is required: Vite's default `localhost` binds ::1 only
      // on macOS and the browser connects over IPv4. See the note in vite.config.ts.
      command: `npm exec --workspace @hirefo/web -- vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      cwd: '../..',
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { VITE_API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
