/** Hard ceilings for sandboxed execution. The worker clamps every job to these. */
export const EXECUTION_LIMITS = {
  /** Wall-clock limit for a single test case, milliseconds. */
  perCaseTimeoutMsDefault: 5_000,
  perCaseTimeoutMsMax: 15_000,
  /** Wall-clock limit for the whole job (all cases + compile), milliseconds. */
  jobTimeoutMsMax: 90_000,
  /** Container memory ceiling, megabytes. */
  memoryMb: 256,
  /** Fraction of one CPU core. */
  cpus: 0.5,
  /** Max processes/threads inside the sandbox (fork-bomb guard). */
  pidsLimit: 64,
  /** Writable scratch space mounted at /sandbox/tmp, megabytes. */
  tmpfsMb: 16,
  /** Max source size accepted by the API, bytes. */
  maxSourceBytes: 128 * 1024,
  /** Max stdin size per test case, bytes. */
  maxStdinBytes: 64 * 1024,
  /** Captured stdout/stderr per test case is truncated to this many bytes. */
  maxOutputBytes: 32 * 1024,
  /** Max test cases evaluated in one job. */
  maxTestCases: 40,
  /** Per-user execution rate limit. */
  rateLimit: { windowMs: 60_000, max: 30 },
} as const;

export const OUTPUT_TRUNCATION_MARKER = '\n…[output truncated]';

/** Normalises program output before comparing with the expected value. */
export function normaliseOutput(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '')
    .trim();
}

export function outputsMatch(actual: string, expected: string): boolean {
  return normaliseOutput(actual) === normaliseOutput(expected);
}
