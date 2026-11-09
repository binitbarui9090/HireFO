import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../logger.js';
import { runtimeFor } from '../runtimes.js';
import { truncate, type RunOutcome, type RunRequest, type SandboxRunner } from './types.js';

/**
 * DEVELOPMENT-ONLY FALLBACK — not a sandbox.
 *
 * Used when EXECUTION_RUNNER=LOCAL_SUBPROCESS, so the project can be exercised on
 * a machine without a Docker daemon. The API and this worker both refuse to start
 * with this runner when NODE_ENV=production.
 *
 * What it does do:
 *   - a fresh temp directory per run, deleted afterwards, used as the cwd
 *   - a scrubbed environment (no inherited secrets, DATABASE_URL, API keys...)
 *   - wall-clock timeout with SIGKILL on the whole process group
 *   - output caps
 *   - `ulimit -v`/`-f`/`-u` where the shell supports it, via a wrapper
 *
 * What it does NOT do, and cannot:
 *   - filesystem isolation: the code runs with the worker user's permissions and
 *     can read anything that user can read
 *   - network isolation: outbound connections are possible
 *   - reliable memory/CPU capping on macOS, where `ulimit -v` is not enforced
 *   - protection against host-level resource exhaustion
 *
 * Treat any environment using this runner as compromised by whatever code is run.
 * See docs/SECURITY.md.
 */
export function createLocalRunner(): SandboxRunner {
  return {
    kind: 'LOCAL_SUBPROCESS',

    async preflight() {
      return {
        ok: true,
        detail:
          'LOCAL_SUBPROCESS fallback active — submitted code runs as a child process on this host with NO container isolation. Development use only.',
      };
    },

    async run(req: RunRequest): Promise<RunOutcome> {
      const spec = runtimeFor(req.language);
      if (!spec) {
        return {
          stdout: '',
          stderr: '',
          exitCode: null,
          durationMs: 0,
          timedOut: false,
          oomKilled: false,
          infraError: `No runtime is defined for "${req.language}".`,
        };
      }

      const dir = await mkdtemp(join(tmpdir(), `hirefo-${randomUUID().slice(0, 8)}-`));
      const sourcePath = join(dir, `main.${spec.localFallback.extension}`);
      const started = Date.now();

      try {
        await writeFile(sourcePath, req.code, { encoding: 'utf8', mode: 0o400 });

        return await new Promise<RunOutcome>((resolve) => {
          const child = spawn(spec.localFallback.command, spec.localFallback.args(sourcePath), {
            cwd: dir,
            stdio: ['pipe', 'pipe', 'pipe'],
            // Scrubbed env: nothing from the worker's own configuration leaks in.
            env: {
              PATH: '/usr/bin:/bin:/usr/local/bin',
              HOME: dir,
              TMPDIR: dir,
              LANG: 'C.UTF-8',
              NODE_OPTIONS: `--max-old-space-size=${req.limits.memoryMb}`,
            },
            // Own process group, so a forked child tree can be killed as a unit.
            detached: true,
          });

          const out: Buffer[] = [];
          const err: Buffer[] = [];
          let outBytes = 0;
          let errBytes = 0;
          let timedOut = false;
          let settled = false;

          const killTree = (signal: NodeJS.Signals) => {
            try {
              if (child.pid) process.kill(-child.pid, signal);
            } catch {
              child.kill(signal);
            }
          };

          const timer = setTimeout(() => {
            timedOut = true;
            killTree('SIGKILL');
          }, req.timeoutMs);

          child.stdout.on('data', (d: Buffer) => {
            if (outBytes < req.limits.maxOutputBytes) {
              out.push(d);
              outBytes += d.length;
            } else killTree('SIGKILL');
          });
          child.stderr.on('data', (d: Buffer) => {
            if (errBytes < req.limits.maxOutputBytes) {
              err.push(d);
              errBytes += d.length;
            }
          });

          const finish = (exitCode: number | null, infraError: string | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            killTree('SIGKILL');
            resolve({
              stdout: truncate(Buffer.concat(out).toString('utf8'), req.limits.maxOutputBytes),
              stderr: truncate(Buffer.concat(err).toString('utf8'), req.limits.maxOutputBytes),
              exitCode,
              durationMs: Date.now() - started,
              timedOut,
              oomKilled: false,
              infraError,
            });
          };

          child.on('error', (e) => finish(null, `Could not start the interpreter: ${e.message}`));
          child.on('close', (code) => finish(code, null));

          child.stdin.on('error', () => undefined);
          child.stdin.end(req.stdin);
        });
      } catch (e) {
        return {
          stdout: '',
          stderr: '',
          exitCode: null,
          durationMs: Date.now() - started,
          timedOut: false,
          oomKilled: false,
          infraError: e instanceof Error ? e.message : String(e),
        };
      } finally {
        await rm(dir, { recursive: true, force: true }).catch((e: unknown) =>
          logger.warn({ err: e, dir }, 'failed to clean up sandbox temp dir'),
        );
      }
    },
  };
}
