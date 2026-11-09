/**
 * Sandbox isolation, against a real Docker daemon.
 *
 * These are the tests that prove the security claims in docs/SECURITY.md are
 * actually true of the running system rather than just of the flags we pass. They
 * are skipped — loudly — when Docker or the runtime images are unavailable, so
 * the suite still runs on a machine without them.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { EXECUTION_LIMITS, type ExecutionLimitsPayload } from '@hirefo/shared';
import { createDockerRunner } from './docker.js';
import type { RunOutcome, SandboxRunner } from './types.js';

const LIMITS: ExecutionLimitsPayload = {
  perCaseTimeoutMs: 5_000,
  jobTimeoutMs: EXECUTION_LIMITS.jobTimeoutMsMax,
  memoryMb: EXECUTION_LIMITS.memoryMb,
  cpus: EXECUTION_LIMITS.cpus,
  pidsLimit: EXECUTION_LIMITS.pidsLimit,
  tmpfsMb: EXECUTION_LIMITS.tmpfsMb,
  maxOutputBytes: EXECUTION_LIMITS.maxOutputBytes,
};

let runner: SandboxRunner;
let available = false;
let reason = '';

beforeAll(async () => {
  runner = createDockerRunner();
  const preflight = await runner.preflight();
  available = preflight.ok;
  reason = preflight.detail;
  if (!available) {
    console.warn(
      `\n  [docker.test.ts] SKIPPING sandbox tests: ${reason}\n` +
        '  Start Docker and run "npm run runtimes:build" to exercise them.\n',
    );
  }
});

/** Runs a program and returns its outcome. */
async function run(
  language: 'javascript' | 'typescript' | 'python',
  code: string,
  stdin = '',
  timeoutMs = 5_000,
): Promise<RunOutcome> {
  return runner.run({
    language,
    code,
    stdin,
    timeoutMs,
    limits: { ...LIMITS, perCaseTimeoutMs: timeoutMs },
    jobId: `test-${Math.random().toString(36).slice(2, 10)}`,
    caseId: 'case',
  });
}

describe.runIf(process.env['SKIP_DOCKER_TESTS'] !== 'true')('docker sandbox', () => {
  describe('execution', () => {
    it.runIf(true)('runs JavaScript and pipes stdin to stdout', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run(
        'javascript',
        `const i = require('fs').readFileSync(0,'utf8').trim();\nconsole.log('got:' + i);\n`,
        'hello',
      );
      expect(outcome.infraError).toBeNull();
      expect(outcome.exitCode).toBe(0);
      expect(outcome.stdout.trim()).toBe('got:hello');
    });

    it('runs Python with isolated mode', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run(
        'python',
        'import sys\nprint(sys.stdin.read().strip().upper())\n',
        'quiet',
      );
      expect(outcome.exitCode).toBe(0);
      expect(outcome.stdout.trim()).toBe('QUIET');
    });

    it('type-checks TypeScript before running it', async () => {
      if (!available) return expect(available).toBe(false);
      const bad = await runner.check!({
        language: 'typescript',
        code: `const n: number = 'definitely a string';\nconsole.log(n);\n`,
        timeoutMs: 20_000,
        limits: LIMITS,
        jobId: 'ts-bad',
      });
      expect(bad.infraError).toBeNull();
      expect(bad.ok).toBe(false);
      expect(bad.output).toMatch(/TS2322|not assignable/);

      const good = await runner.check!({
        language: 'typescript',
        code: `const n: number = 41;\nconsole.log(n + 1);\n`,
        timeoutMs: 20_000,
        limits: LIMITS,
        jobId: 'ts-good',
      });
      expect(good.ok).toBe(true);
    });

    it('runs type-correct TypeScript', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run(
        'typescript',
        `import { readFileSync } from 'node:fs';\nconst n: number = Number(readFileSync(0,'utf8').trim());\nconsole.log(n * 2);\n`,
        '21',
      );
      expect(outcome.exitCode).toBe(0);
      expect(outcome.stdout.trim()).toBe('42');
    });

    it('reports a non-zero exit and captures stderr', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run('javascript', `console.error('to stderr');\nprocess.exit(3);\n`);
      expect(outcome.exitCode).toBe(3);
      expect(outcome.stderr).toContain('to stderr');
    });

    it('keeps each run in its own container, with no shared state', async () => {
      if (!available) return expect(available).toBe(false);
      const write = await run(
        'javascript',
        `require('fs').writeFileSync('/sandbox/leak.txt', 'secret');\nconsole.log('wrote');\n`,
      );
      expect(write.exitCode).toBe(0);

      const read = await run(
        'javascript',
        `const fs = require('fs');\nconsole.log(fs.existsSync('/sandbox/leak.txt') ? 'LEAKED' : 'clean');\n`,
      );
      expect(read.stdout.trim()).toBe('clean');
    });
  });

  describe('isolation', () => {
    it('blocks outbound HTTP', async () => {
      if (!available) return expect(available).toBe(false);
      // writeSync + an immediate exit: a program killed by the watchdog loses
      // whatever Node had buffered, which would make this test lie.
      const outcome = await run(
        'javascript',
        `const fs = require('fs');
require('https')
  .get('https://example.com', () => { fs.writeSync(1, 'REACHED\\n'); process.exit(0); })
  .on('error', (e) => { fs.writeSync(1, 'BLOCKED ' + e.code + '\\n'); process.exit(0); });
`,
        '',
        8_000,
      );
      expect(outcome.stdout).not.toContain('REACHED');
      expect(outcome.stdout).toContain('BLOCKED');
    });

    it('blocks raw TCP connections', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run(
        'python',
        'import socket\n'
          + 's = socket.socket()\n'
          + 's.settimeout(2)\n'
          + 'try:\n'
          + '    s.connect(("1.1.1.1", 80))\n'
          + '    print("REACHED", flush=True)\n'
          + 'except Exception as e:\n'
          + '    print("BLOCKED", type(e).__name__, flush=True)\n',
        '',
        8_000,
      );
      expect(outcome.stdout).not.toContain('REACHED');
      expect(outcome.stdout).toContain('BLOCKED');
    });

    it('blocks DNS resolution', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run(
        'python',
        'import socket\n'
          + 'try:\n'
          + '    print("RESOLVED", socket.gethostbyname("example.com"), flush=True)\n'
          + 'except Exception as e:\n'
          + '    print("BLOCKED", type(e).__name__, flush=True)\n',
        '',
        8_000,
      );
      expect(outcome.stdout).not.toContain('RESOLVED');
      expect(outcome.stdout).toContain('BLOCKED');
    });

    it('cannot see the host filesystem', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run(
        'python',
        'import os\n'
          + 'for p in ["/Users", "/home/kevin", "/var/run/docker.sock", "/etc/shadow"]:\n'
          + '    print(p, os.path.exists(p))\n',
      );
      expect(outcome.stdout).toContain('/Users False');
      expect(outcome.stdout).toContain('/var/run/docker.sock False');
    });

    it('has a read-only root filesystem', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run(
        'python',
        'try:\n    open("/etc/passwd", "a").write("x")\n    print("WRITABLE")\nexcept OSError as e:\n    print("READONLY", e.errno)\n',
      );
      expect(outcome.stdout).toContain('READONLY');
      expect(outcome.stdout).not.toContain('WRITABLE');
    });

    it('runs as an unprivileged user, never root', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run('python', 'import os\nprint("uid", os.getuid(), "gid", os.getgid())\n');
      expect(outcome.stdout).toContain('uid 65534');
      expect(outcome.stdout).not.toContain('uid 0');
    });

    it('cannot create an executable in its one writable directory', async () => {
      if (!available) return expect(available).toBe(false);
      // /sandbox is mounted noexec, so even a successfully written script cannot run.
      const outcome = await run(
        'python',
        'import os, subprocess\n'
          + 'p = "/sandbox/evil.sh"\n'
          + 'open(p, "w").write("#!/bin/sh\\necho pwned\\n")\n'
          + 'os.chmod(p, 0o755)\n'
          + 'try:\n'
          + '    print(subprocess.run([p], capture_output=True, text=True).stdout or "NO OUTPUT")\n'
          + 'except OSError as e:\n'
          + '    print("NOEXEC", e.errno)\n',
      );
      expect(outcome.stdout).not.toContain('pwned');
    });
  });

  describe('resource limits', () => {
    it('kills an infinite loop and reports it as a timeout', async () => {
      if (!available) return expect(available).toBe(false);
      const started = Date.now();
      const outcome = await run('javascript', 'while (true) {}\n', '', 3_000);
      const elapsed = Date.now() - started;

      expect(outcome.timedOut).toBe(true);
      expect(outcome.oomKilled).toBe(false);
      // Must be killed near the deadline, not left running.
      expect(elapsed).toBeLessThan(20_000);
    });

    it('kills a sleeping program that exceeds its deadline', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run(
        'python',
        'import time\ntime.sleep(30)\nprint("FINISHED")\n',
        '',
        2_000,
      );
      expect(outcome.timedOut).toBe(true);
      expect(outcome.stdout).not.toContain('FINISHED');
    });

    it('kills a program that exceeds the memory limit and flags it as OOM', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run(
        'python',
        'x = bytearray(2_000_000_000)\nprint("ALLOCATED", len(x))\n',
        '',
        15_000,
      );
      expect(outcome.stdout).not.toContain('ALLOCATED');
      expect(outcome.oomKilled).toBe(true);
      // An OOM kill is not reported as a timeout — the reasons are distinct.
      expect(outcome.timedOut).toBe(false);
    });

    it('caps the process count, containing a fork bomb', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run(
        'python',
        'import os\n'
          + 'n = 0\n'
          + 'try:\n'
          + '    while n < 500:\n'
          + '        if os.fork() == 0:\n'
          + '            os._exit(0)\n'
          + '        n += 1\n'
          + '    print("UNCAPPED", n)\n'
          + 'except OSError as e:\n'
          + '    print("CAPPED", type(e).__name__)\n',
        '',
        10_000,
      );
      expect(outcome.stdout).not.toContain('UNCAPPED');
    });

    it('truncates runaway output instead of buffering it without bound', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await run(
        'javascript',
        `const line = 'x'.repeat(1000) + '\\n';\nfor (let i = 0; i < 5000; i++) process.stdout.write(line);\n`,
        '',
        10_000,
      );
      const bytes = Buffer.byteLength(outcome.stdout, 'utf8');
      // Comfortably above the cap would mean the cap is not working.
      expect(bytes).toBeLessThan(EXECUTION_LIMITS.maxOutputBytes * 3);
    });
  });

  describe('cleanup', () => {
    it('leaves no containers behind', async () => {
      if (!available) return expect(available).toBe(false);
      await Promise.all([
        run('javascript', 'console.log(1)'),
        run('javascript', 'while(true){}', '', 2_000),
        run('python', 'print(2)'),
      ]);

      const { execFileSync } = await import('node:child_process');
      const names = execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}'], {
        encoding: 'utf8',
      });
      const leftovers = names
        .split('\n')
        .map((n) => n.trim())
        .filter((n) => n.startsWith('hirefo-') && !n.startsWith('hirefo-postgres') && !n.startsWith('hirefo-redis'));
      expect(leftovers).toEqual([]);
    });
  });

  describe('unsupported language', () => {
    it('reports an infra error rather than throwing', async () => {
      if (!available) return expect(available).toBe(false);
      const outcome = await runner.run({
        language: 'sql' as never,
        code: 'SELECT 1;',
        stdin: '',
        timeoutMs: 2_000,
        limits: LIMITS,
        jobId: 'unsupported',
        caseId: 'case',
      });
      expect(outcome.infraError).toMatch(/No sandbox runtime/);
    });
  });
});
