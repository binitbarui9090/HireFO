import type { ExecutionLimitsPayload, LanguageId } from '@hirefo/shared';

export interface RunRequest {
  language: LanguageId;
  code: string;
  stdin: string;
  timeoutMs: number;
  limits: ExecutionLimitsPayload;
  /** Correlation id used for container names and log lines. */
  jobId: string;
  caseId: string;
}

export interface RunOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  oomKilled: boolean;
  /** Set when the runner itself failed (image missing, daemon down, ...). */
  infraError: string | null;
}

export interface CheckOutcome {
  ok: boolean;
  output: string;
  infraError: string | null;
}

export interface SandboxRunner {
  readonly kind: 'DOCKER' | 'LOCAL_SUBPROCESS';
  /** Verifies the runner can actually execute — called at worker boot. */
  preflight(): Promise<{ ok: boolean; detail: string }>;
  /** Optional compile/type check performed once per job. */
  check?(req: Omit<RunRequest, 'stdin' | 'caseId'>): Promise<CheckOutcome>;
  run(req: RunRequest): Promise<RunOutcome>;
}

export function truncate(value: string, maxBytes: number): string {
  const buf = Buffer.from(value, 'utf8');
  if (buf.length <= maxBytes) return value;
  return `${buf.subarray(0, maxBytes).toString('utf8')}\n…[truncated, limit ${maxBytes} bytes]`;
}
