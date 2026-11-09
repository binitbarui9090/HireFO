import { describe, expect, it } from 'vitest';
import {
  EXECUTION_LIMITS,
  isTerminalExecutionStatus,
  normaliseOutput,
  outputsMatch,
  TERMINAL_EXECUTION_STATUSES,
} from './index.js';

describe('normaliseOutput', () => {
  it('strips trailing whitespace on each line', () => {
    expect(normaliseOutput('a   \nb\t\n')).toBe('a\nb');
  });

  it('normalises CRLF to LF', () => {
    expect(normaliseOutput('a\r\nb')).toBe('a\nb');
  });

  it('drops trailing newlines', () => {
    expect(normaliseOutput('answer\n\n\n')).toBe('answer');
  });

  it('keeps interior blank lines, which can be significant', () => {
    expect(normaliseOutput('a\n\nb')).toBe('a\n\nb');
  });

  it('keeps leading whitespace, which can be significant', () => {
    expect(normaliseOutput('  indented')).toBe('indented');
    expect(normaliseOutput('a\n  indented')).toBe('a\n  indented');
  });

  it('returns an empty string for whitespace-only output', () => {
    expect(normaliseOutput('   \n\t\n  ')).toBe('');
  });
});

describe('outputsMatch', () => {
  it('ignores trailing whitespace and newline differences', () => {
    expect(outputsMatch('42\n', '42')).toBe(true);
    expect(outputsMatch('42', '42\n\n')).toBe(true);
    expect(outputsMatch('1 2  \r\n', '1 2')).toBe(true);
  });

  it('treats a multi-line answer as equal regardless of the final newline', () => {
    expect(outputsMatch('1 6\n8 10\n15 18\n', '1 6\n8 10\n15 18')).toBe(true);
  });

  it('does not ignore a genuine difference', () => {
    expect(outputsMatch('42', '43')).toBe(false);
    expect(outputsMatch('1 2', '2 1')).toBe(false);
    expect(outputsMatch('a\nb', 'a b')).toBe(false);
  });

  it('does not treat interior spacing as equivalent', () => {
    expect(outputsMatch('1  2', '1 2')).toBe(false);
  });

  it('matches two empty outputs', () => {
    expect(outputsMatch('', '')).toBe(true);
    expect(outputsMatch('\n', '')).toBe(true);
  });

  it('does not match empty output against a real expectation', () => {
    expect(outputsMatch('', '42')).toBe(false);
  });
});

describe('execution status helpers', () => {
  it('classifies terminal statuses', () => {
    for (const status of TERMINAL_EXECUTION_STATUSES) {
      expect(isTerminalExecutionStatus(status)).toBe(true);
    }
    expect(isTerminalExecutionStatus('QUEUED')).toBe(false);
    expect(isTerminalExecutionStatus('RUNNING')).toBe(false);
  });
});

describe('EXECUTION_LIMITS', () => {
  it('keeps the default per-case timeout under the maximum', () => {
    expect(EXECUTION_LIMITS.perCaseTimeoutMsDefault).toBeLessThanOrEqual(
      EXECUTION_LIMITS.perCaseTimeoutMsMax,
    );
  });

  it('allows the whole case budget to fit inside the job budget', () => {
    // Enough room for the maximum number of cases at the default budget would be
    // ideal; at minimum one maximal case must fit.
    expect(EXECUTION_LIMITS.jobTimeoutMsMax).toBeGreaterThan(EXECUTION_LIMITS.perCaseTimeoutMsMax);
  });

  it('caps resources to values a single host can serve concurrently', () => {
    expect(EXECUTION_LIMITS.memoryMb).toBeGreaterThan(0);
    expect(EXECUTION_LIMITS.memoryMb).toBeLessThanOrEqual(1024);
    expect(EXECUTION_LIMITS.cpus).toBeGreaterThan(0);
    expect(EXECUTION_LIMITS.cpus).toBeLessThanOrEqual(2);
    expect(EXECUTION_LIMITS.pidsLimit).toBeGreaterThanOrEqual(16);
  });

  it('keeps the output cap below the source cap, so output cannot be used to exfiltrate more', () => {
    expect(EXECUTION_LIMITS.maxOutputBytes).toBeLessThanOrEqual(EXECUTION_LIMITS.maxSourceBytes);
  });
});
