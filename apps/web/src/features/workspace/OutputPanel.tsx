import { useState } from 'react';
import { Badge, Callout, EmptyState, executionStatusTone, Spinner } from '../../components/ui/Primitives';
import { formatMs, formatRelative, titleCase } from '../../lib/format';
import type { ExecutionDetailDto, ExecutionHistoryItem } from '../interviews/types';
import styles from './Workspace.module.css';

export interface OutputPanelProps {
  execution: ExecutionDetailDto | null;
  /** True between enqueueing and the terminal status arriving. */
  running: boolean;
  /** Live progress from the socket while the worker is chewing through cases. */
  progress: { passedCount?: number; totalCount?: number; status: string } | null;
  history: ExecutionHistoryItem[];
  customStdin: string;
  onCustomStdinChange: (value: string) => void;
  onSelectHistory: (executionId: string) => void;
  /** False when the question has no test cases, so the stdin box is the input. */
  hasTestCases: boolean;
  isStaff: boolean;
}

type Tab = 'console' | 'tests' | 'history';

export function OutputPanel({
  execution,
  running,
  progress,
  history,
  customStdin,
  onCustomStdinChange,
  onSelectHistory,
  hasTestCases,
  isStaff,
}: OutputPanelProps) {
  const [tab, setTab] = useState<Tab>(hasTestCases ? 'tests' : 'console');
  const [expanded, setExpanded] = useState<string | null>(null);

  const result = execution?.result ?? null;
  const tests = execution?.testResults ?? [];
  const failedCount = tests.filter((t) => !t.passed).length;

  return (
    <div className={styles.panel}>
      {/* A real tablist, so screen readers announce it as one and the selected
          tab is programmatically determinable. */}
      <div className={styles.outputTabs} role="tablist" aria-label="Execution output">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'tests'}
          className={[styles.outputTab, tab === 'tests' ? styles.outputTabActive : ''].filter(Boolean).join(' ')}
          onClick={() => setTab('tests')}
        >
          Tests
          {tests.length > 0 && (
            <span className={styles.outputCount}>
              {tests.filter((t) => t.passed).length}/{tests.length}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'console'}
          className={[styles.outputTab, tab === 'console' ? styles.outputTabActive : ''].filter(Boolean).join(' ')}
          onClick={() => setTab('console')}
        >
          Console
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={[styles.outputTab, tab === 'history' ? styles.outputTabActive : ''].filter(Boolean).join(' ')}
          onClick={() => setTab('history')}
        >
          History
          {history.length > 0 && <span className={styles.outputCount}>{history.length}</span>}
        </button>

        <div style={{ flex: 1 }} />

        {running && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-tertiary)',
              paddingInlineEnd: 'var(--space-2)',
            }}
          >
            <Spinner size={11} />
            {progress?.passedCount !== undefined && progress.totalCount
              ? `${progress.passedCount}/${progress.totalCount} passed`
              : 'queued'}
          </span>
        )}
        {!running && execution && (
          <span style={{ paddingInlineEnd: 'var(--space-2)' }}>
            <Badge tone={executionStatusTone[execution.status] ?? 'neutral'} dot>
              {titleCase(execution.status)}
            </Badge>
          </span>
        )}
      </div>

      <div className={styles.panelScroll}>
        {tab === 'tests' &&
          (tests.length === 0 ? (
            <EmptyState
              icon="✓"
              title={
                running
                  ? 'Running…'
                  : execution
                    ? 'No test cases were evaluated'
                    : 'No results yet'
              }
              body={
                running
                  ? 'The worker is executing each case in its own container.'
                  : execution
                    ? 'This run had no question test cases attached, so only the console output is available.'
                    : hasTestCases
                      ? 'Press Run to check the example cases, or Submit to include the hidden ones.'
                      : 'This question has no test cases. Use the Console tab with custom input.'
              }
            />
          ) : (
            <div className={styles.testList}>
              {tests.map((test) => {
                const isOpen = expanded === test.testCaseId;
                return (
                  <div key={test.testCaseId} className={styles.testRow}>
                    <button
                      type="button"
                      className={styles.testSummary}
                      onClick={() => setExpanded(isOpen ? null : test.testCaseId)}
                      aria-expanded={isOpen}
                    >
                      <span
                        className={[
                          styles.testMark,
                          test.passed ? styles.markPass : styles.markFail,
                        ].join(' ')}
                        aria-hidden="true"
                      >
                        {test.passed ? '✓' : '✕'}
                      </span>
                      <span className={styles.testName}>{test.name}</span>
                      {test.visibility === 'HIDDEN' && <Badge tone="neutral">hidden</Badge>}
                      {test.timedOut && <Badge tone="warning">timeout</Badge>}
                      <span className={styles.testTime}>{formatMs(test.durationMs)}</span>
                    </button>

                    {isOpen && (
                      <div className={styles.testDetail}>
                        {test.hiddenNotice ? (
                          <Callout tone="neutral">{test.hiddenNotice}</Callout>
                        ) : (
                          <>
                            <div className={styles.diffGrid}>
                              <span className={styles.diffKey}>Input</span>
                              <span className={styles.diffValue}>{test.input || '(empty)'}</span>
                              <span className={styles.diffKey}>Expected</span>
                              <span className={[styles.diffValue, styles.diffExpected].join(' ')}>
                                {test.expectedOutput || '(empty)'}
                              </span>
                              <span className={styles.diffKey}>Actual</span>
                              <span
                                className={[
                                  styles.diffValue,
                                  test.passed ? styles.diffExpected : styles.diffActual,
                                ].join(' ')}
                              >
                                {test.actualOutput || '(no output)'}
                              </span>
                            </div>
                            {test.stderr && (
                              <div className={styles.consoleSection}>
                                <span className={styles.consoleLabel}>stderr</span>
                                <pre className={[styles.console, styles.consoleError].join(' ')} style={{ padding: 0 }}>
                                  {test.stderr}
                                </pre>
                              </div>
                            )}
                            {test.errorMessage && (
                              <Callout tone="warning">{test.errorMessage}</Callout>
                            )}
                            {test.explanation && isStaff && (
                              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                                {test.explanation}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {failedCount > 0 && (
                <div style={{ padding: 'var(--space-3)' }}>
                  <Callout tone="neutral">
                    {failedCount} of {tests.length} cases failed. Expand a row to see the input and
                    the difference.
                  </Callout>
                </div>
              )}
            </div>
          ))}

        {tab === 'console' && (
          <div>
            {!hasTestCases && (
              <div style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--border-subtle)' }}>
                <label
                  className={styles.consoleLabel}
                  htmlFor="custom-stdin"
                  style={{ marginBottom: 'var(--space-2)' }}
                >
                  stdin for the next run
                </label>
                <textarea
                  id="custom-stdin"
                  className={styles.stdinBox}
                  value={customStdin}
                  onChange={(event) => onCustomStdinChange(event.target.value)}
                  placeholder="Text piped to the program's standard input"
                  spellCheck={false}
                />
              </div>
            )}

            {execution?.errorMessage && (
              <div style={{ padding: 'var(--space-3)' }}>
                <Callout tone="danger" title="Execution problem">
                  {execution.errorMessage}
                </Callout>
              </div>
            )}

            {result?.compileOutput && (
              <div className={styles.consoleSection} style={{ padding: 'var(--space-3)' }}>
                <span className={styles.consoleLabel}>compiler</span>
                <pre className={[styles.console, styles.consoleError].join(' ')} style={{ padding: 0 }}>
                  {result.compileOutput}
                </pre>
              </div>
            )}

            {result ? (
              <div style={{ padding: 'var(--space-3)' }}>
                <div className={styles.consoleSection}>
                  <span className={styles.consoleLabel}>stdout</span>
                  <pre className={styles.console} style={{ padding: 0 }}>
                    {result.stdout || '(no output)'}
                  </pre>
                </div>
                {result.stderr && (
                  <div className={styles.consoleSection}>
                    <span className={styles.consoleLabel}>stderr</span>
                    <pre className={[styles.console, styles.consoleError].join(' ')} style={{ padding: 0 }}>
                      {result.stderr}
                    </pre>
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-3)',
                    flexWrap: 'wrap',
                    fontSize: 'var(--text-2xs)',
                    color: 'var(--text-tertiary)',
                    paddingTop: 'var(--space-2)',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <span>exit {result.exitCode ?? '—'}</span>
                  <span>{formatMs(result.durationMs)}</span>
                  {result.timedOut && <span style={{ color: 'var(--warning-text)' }}>timed out</span>}
                  {result.oomKilled && (
                    <span style={{ color: 'var(--danger-text)' }}>killed: out of memory</span>
                  )}
                  {execution && <span>runner: {execution.runnerKind.toLowerCase()}</span>}
                </div>
              </div>
            ) : (
              !execution?.errorMessage && (
                <EmptyState
                  icon="▸"
                  title={running ? 'Waiting for output…' : 'Nothing has run yet'}
                  body={
                    running
                      ? 'Output appears once the sandbox finishes.'
                      : 'Press Run to execute the current buffer in an isolated container.'
                  }
                />
              )
            )}
          </div>
        )}

        {tab === 'history' &&
          (history.length === 0 ? (
            <EmptyState icon="◴" title="No runs yet" body="Every execution in this interview is listed here." />
          ) : (
            <div className={styles.testList}>
              {history.map((item) => (
                <div key={item.submissionId} className={styles.testRow}>
                  <button
                    type="button"
                    className={styles.testSummary}
                    onClick={() => item.execution && onSelectHistory(item.execution.id)}
                    disabled={!item.execution}
                  >
                    <span
                      className={[
                        styles.testMark,
                        item.execution?.status === 'SUCCEEDED'
                          ? styles.markPass
                          : item.execution && ['FAILED', 'ERROR', 'TIMEOUT'].includes(item.execution.status)
                            ? styles.markFail
                            : styles.markSkip,
                      ].join(' ')}
                      aria-hidden="true"
                    >
                      {item.kind === 'SUBMIT' ? 'S' : 'R'}
                    </span>
                    <span className={styles.testName}>
                      {item.question?.title ?? 'Scratch run'} · {item.author.name}
                    </span>
                    {item.execution?.passedCount !== null && item.execution?.totalCount ? (
                      <Badge
                        tone={
                          item.execution.passedCount === item.execution.totalCount
                            ? 'success'
                            : 'danger'
                        }
                      >
                        {item.execution.passedCount}/{item.execution.totalCount}
                      </Badge>
                    ) : (
                      <Badge tone={executionStatusTone[item.execution?.status ?? 'QUEUED'] ?? 'neutral'}>
                        {titleCase(item.execution?.status ?? 'queued')}
                      </Badge>
                    )}
                    <span className={styles.testTime}>{formatRelative(item.createdAt)}</span>
                  </button>
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
