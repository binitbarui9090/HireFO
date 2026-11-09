import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { runtimeFor } from '../runtimes.js';
import { truncate, type CheckOutcome, type RunOutcome, type RunRequest, type SandboxRunner } from './types.js';

/**
 * Docker sandbox.
 *
 * Every test case gets a brand-new container that is destroyed afterwards, so one
 * case cannot observe or affect another. Defence in depth, each line independent:
 *
 *   --network none            no egress, no lateral movement, no DNS
 *   --read-only               root filesystem is immutable
 *   --tmpfs …:noexec,nosuid   the one writable path cannot host a new executable
 *   --cap-drop ALL            no Linux capabilities whatsoever
 *   --security-opt no-new-privileges  setuid binaries cannot elevate
 *   --user 65534:65534        runs as nobody; never root, even inside the sandbox
 *   --memory / --memory-swap  equal values, so swap cannot be used to exceed RAM
 *   --cpus                    CPU share cap
 *   --pids-limit              fork-bomb guard
 *   --ulimit nofile/fsize     file-descriptor and write-size caps
 *   no bind mounts            the host filesystem is not reachable at all
 *
 * The source is handed over in an environment variable and written to the tmpfs by
 * the image's entrypoint, which is why no mount is needed.
 */
export function createDockerRunner(): SandboxRunner {
  const cfg = config();

  async function dockerRun(opts: {
    args: string[];
    env: NodeJS.ProcessEnv;
    stdin: string;
    timeoutMs: number;
    maxOutputBytes: number;
    containerName: string;
  }): Promise<RunOutcome> {
    const { args, env, stdin, timeoutMs, maxOutputBytes, containerName } = opts;
    const started = Date.now();
    return new Promise<RunOutcome>((resolve) => {
      // The env is built per call and passed explicitly, so concurrent jobs never
      // see each other's source.
      const child = spawn(cfg.DOCKER_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'], env });

      const chunks: { out: Buffer[]; err: Buffer[] } = { out: [], err: [] };
      let outBytes = 0;
      let errBytes = 0;
      let timedOut = false;
      let settled = false;

      // Hard ceiling slightly above the per-case budget: the in-container watchdog
      // should fire first; this is the backstop if the daemon itself wedges.
      const timer = setTimeout(() => {
        timedOut = true;
        // Kill the container, not just the CLI: killing `docker run` leaves the
        // container alive.
        spawn(cfg.DOCKER_BIN, ['kill', '--signal', 'SIGKILL', containerName], {
          stdio: 'ignore',
        }).on('error', () => undefined);
        child.kill('SIGKILL');
      }, timeoutMs + 1_000);

      child.stdout.on('data', (d: Buffer) => {
        if (outBytes < maxOutputBytes) {
          chunks.out.push(d);
          outBytes += d.length;
        }
      });
      child.stderr.on('data', (d: Buffer) => {
        if (errBytes < maxOutputBytes) {
          chunks.err.push(d);
          errBytes += d.length;
        }
      });

      const finish = (exitCode: number | null, infraError: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: truncate(Buffer.concat(chunks.out).toString('utf8'), maxOutputBytes),
          stderr: truncate(Buffer.concat(chunks.err).toString('utf8'), maxOutputBytes),
          exitCode,
          durationMs: Date.now() - started,
          timedOut,
          oomKilled: false,
          infraError,
        });
      };

      child.on('error', (err) => finish(null, `Could not start Docker: ${err.message}`));
      child.on('close', (code) => finish(code, null));

      child.stdin.on('error', () => undefined);
      child.stdin.end(stdin);
    });
  }

  /** Reads the container's real resource outcome before deleting it. */
  async function inspectAndRemove(
    containerName: string,
  ): Promise<{ oomKilled: boolean; exitCode: number | null }> {
    const read = await new Promise<string>((resolve) => {
      const child = spawn(
        cfg.DOCKER_BIN,
        ['inspect', '--format', '{{.State.OOMKilled}} {{.State.ExitCode}}', containerName],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const out: Buffer[] = [];
      child.stdout.on('data', (d: Buffer) => out.push(d));
      child.on('error', () => resolve(''));
      child.on('close', () => resolve(Buffer.concat(out).toString('utf8').trim()));
    });

    // Awaited: "process cleanup" has to mean the container is actually gone before
    // we report the run as finished, otherwise a timed-out run can leave a stopped
    // container behind until the next prune.
    await new Promise<void>((resolve) => {
      const rm = spawn(cfg.DOCKER_BIN, ['rm', '-f', containerName], { stdio: 'ignore' });
      rm.on('error', () => resolve());
      rm.on('close', () => resolve());
    });

    const [oom, code] = read.split(/\s+/);
    return {
      oomKilled: oom === 'true',
      exitCode: code !== undefined && code !== '' ? Number(code) : null,
    };
  }

  function baseArgs(req: Pick<RunRequest, 'limits' | 'code'>, containerName: string): string[] {
    const l = req.limits;
    return [
      'run',
      '--name',
      containerName,
      '--interactive',
      '--network',
      'none',
      '--read-only',
      '--tmpfs',
      // uid/gid/mode are required: a default tmpfs is root-owned and mode 0755,
      // which the unprivileged sandbox user could not write to.
      `/sandbox:rw,noexec,nosuid,nodev,size=${l.tmpfsMb}m,uid=65534,gid=65534,mode=0700`,
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      '65534:65534',
      '--memory',
      `${l.memoryMb}m`,
      '--memory-swap',
      `${l.memoryMb}m`,
      '--cpus',
      String(l.cpus),
      '--pids-limit',
      String(l.pidsLimit),
      '--ulimit',
      'nofile=256:256',
      '--ulimit',
      `fsize=${l.tmpfsMb * 1024 * 1024}`,
      '--workdir',
      '/sandbox',
      '--env',
      // Passed via the env *array*, so the source never appears in a command line
      // (and therefore never in the host's process list).
      'HIREFO_SOURCE_B64',
      '--env',
      'HIREFO_TIMEOUT_SECONDS',
      '--env',
      'HOME=/sandbox',
    ];
  }

  function childEnv(req: Pick<RunRequest, 'code' | 'timeoutMs'>): NodeJS.ProcessEnv {
    return {
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
      DOCKER_HOST: process.env['DOCKER_HOST'] ?? '',
      HOME: process.env['HOME'] ?? '',
      HIREFO_SOURCE_B64: Buffer.from(req.code, 'utf8').toString('base64'),
      HIREFO_TIMEOUT_SECONDS: String(Math.ceil(req.timeoutMs / 1000)),
    };
  }

  return {
    kind: 'DOCKER',

    async preflight() {
      const version = await new Promise<{ code: number | null; out: string }>((resolve) => {
        const child = spawn(cfg.DOCKER_BIN, ['version', '--format', '{{.Server.Version}}'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const out: Buffer[] = [];
        child.stdout.on('data', (d: Buffer) => out.push(d));
        child.stderr.on('data', (d: Buffer) => out.push(d));
        child.on('error', (err) => resolve({ code: null, out: err.message }));
        child.on('close', (code) => resolve({ code, out: Buffer.concat(out).toString('utf8').trim() }));
      });
      if (version.code !== 0) {
        return { ok: false, detail: `Docker daemon unreachable: ${version.out}` };
      }

      // Every executable language needs its image present; a missing image would
      // otherwise surface as a per-submission failure.
      const missing: string[] = [];
      for (const language of ['javascript', 'python'] as const) {
        const spec = runtimeFor(language);
        if (!spec) continue;
        const present = await new Promise<boolean>((resolve) => {
          const child = spawn(cfg.DOCKER_BIN, ['image', 'inspect', spec.image], { stdio: 'ignore' });
          child.on('error', () => resolve(false));
          child.on('close', (code) => resolve(code === 0));
        });
        if (!present) missing.push(spec.image);
      }
      if (missing.length) {
        return {
          ok: false,
          detail: `Runtime image(s) not built: ${missing.join(', ')}. Run "npm run runtimes:build".`,
        };
      }
      return { ok: true, detail: `Docker ${version.out}` };
    },

    async check(req): Promise<CheckOutcome> {
      const spec = runtimeFor(req.language);
      if (!spec?.checkCommand) return { ok: true, output: '', infraError: null };

      const containerName = `hirefo-check-${req.jobId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
      const outcome = await dockerRun({
        args: [...baseArgs(req, containerName), spec.image, ...spec.checkCommand!],
        env: childEnv(req),
        stdin: '',
        timeoutMs: Math.min(req.timeoutMs * 3, 30_000),
        maxOutputBytes: req.limits.maxOutputBytes,
        containerName,
      });
      await inspectAndRemove(containerName);

      if (outcome.infraError) return { ok: false, output: '', infraError: outcome.infraError };
      return {
        ok: outcome.exitCode === 0,
        output: [outcome.stdout, outcome.stderr].filter(Boolean).join('\n').trim(),
        infraError: null,
      };
    },

    async run(req): Promise<RunOutcome> {
      const spec = runtimeFor(req.language);
      if (!spec) {
        return {
          stdout: '',
          stderr: '',
          exitCode: null,
          durationMs: 0,
          timedOut: false,
          oomKilled: false,
          infraError: `No sandbox runtime is defined for "${req.language}".`,
        };
      }

      const containerName = `hirefo-${req.jobId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
      try {
        const outcome = await dockerRun({
          args: [...baseArgs(req, containerName), spec.image, ...spec.runCommand],
          env: childEnv(req),
          stdin: req.stdin,
          timeoutMs: req.timeoutMs,
          maxOutputBytes: req.limits.maxOutputBytes,
          containerName,
        });
        const inspected = await inspectAndRemove(containerName);
        const exitCode = outcome.exitCode ?? inspected.exitCode;

        // The in-container `timeout -s KILL` is the first line of defence and
        // usually fires before our own timer, so `docker run` exits cleanly and
        // only the code tells us what happened:
        //   137 = 128 + SIGKILL  -> killed (watchdog, or the OOM killer)
        //   124                  -> GNU timeout's own "deadline exceeded" code
        // OOMKilled from `docker inspect` disambiguates 137, so a 137 that is not
        // an OOM is a timeout.
        const killedBySignal = exitCode === 137 || exitCode === 124;
        const timedOut = outcome.timedOut || (killedBySignal && !inspected.oomKilled);

        return {
          ...outcome,
          timedOut,
          oomKilled: inspected.oomKilled,
          exitCode,
        };
      } catch (err) {
        logger.error({ err, jobId: req.jobId }, 'docker run failed unexpectedly');
        await inspectAndRemove(containerName).catch(() => undefined);
        return {
          stdout: '',
          stderr: '',
          exitCode: null,
          durationMs: 0,
          timedOut: false,
          oomKilled: false,
          infraError: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
