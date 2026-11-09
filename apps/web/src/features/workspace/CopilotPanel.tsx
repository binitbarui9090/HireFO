import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiSuggestionKind, AiSuggestionPayload } from '@hirefo/shared';
import { Badge, Callout, EmptyState, Spinner } from '../../components/ui/Primitives';
import { api, ApiError, streamSse } from '../../lib/api';
import { formatMs, formatRelative, formatUsd } from '../../lib/format';
import { useCapabilitiesStore } from '../../store/capabilities';
import { toast } from '../../store/toast';
import styles from './Workspace.module.css';

interface SuggestionRecord {
  id: string;
  kind: AiSuggestionKind;
  payload: AiSuggestionPayload;
  provider: string;
  model: string;
  instruction?: string | null;
  requestedBy?: { id: string; name: string };
  usage: { promptTokens: number; completionTokens: number; costUsd: number; latencyMs: number };
  degraded: boolean;
  degradedReason: string | null;
  createdAt: string;
}

interface UnavailableBody {
  available: false;
  reason: string;
  message: string;
}

/** The actions offered in the panel, in the order an interviewer tends to need them. */
const ACTIONS: { kind: AiSuggestionKind; label: string; blurb: string }[] = [
  { kind: 'EDGE_CASES', label: 'Edge cases', blurb: 'What this code misses' },
  { kind: 'FOLLOW_UP_QUESTIONS', label: 'Follow-ups', blurb: 'Questions on what they wrote' },
  { kind: 'INTERVIEWER_HINT', label: 'Graduated hints', blurb: 'If they are stuck' },
  { kind: 'EXPLAIN_TEST_FAILURE', label: 'Explain failure', blurb: 'Why a test failed' },
  { kind: 'APPROACH_SUMMARY', label: 'Approach', blurb: 'Summarise the solution' },
  { kind: 'REASONING_GAPS', label: 'Reasoning gaps', blurb: 'Unexamined assumptions' },
  { kind: 'DIFFICULTY_CALIBRATION', label: 'Calibrate', blurb: 'Raise or lower difficulty' },
  { kind: 'STRUCTURED_NOTES', label: 'Draft notes', blurb: 'Notes you can edit' },
];

export interface CopilotPanelProps {
  interviewId: string;
  activeQuestionId: string | null;
  /** The buffer the interviewer is looking at right now. */
  code: string;
  latestExecutionJobId: string | null;
  /** Lets the interviewer push drafted notes straight into the notes panel. */
  onUseAsNote: (text: string) => void;
}

export function CopilotPanel({
  interviewId,
  activeQuestionId,
  code,
  latestExecutionJobId,
  onUseAsNote,
}: CopilotPanelProps) {
  const capabilities = useCapabilitiesStore((s) => s.data);
  const [suggestions, setSuggestions] = useState<SuggestionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingKind, setPendingKind] = useState<AiSuggestionKind | null>(null);
  const [streamText, setStreamText] = useState('');
  const [unavailable, setUnavailable] = useState<UnavailableBody | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const aiEnabled = capabilities?.ai.enabled ?? false;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<{ items: SuggestionRecord[] }>(
          `/api/ai/interviews/${interviewId}/suggestions`,
        );
        if (!cancelled) setSuggestions(data.items);
      } catch {
        /* an empty history is not an error worth shouting about */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [interviewId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const request = useCallback(
    async (kind: AiSuggestionKind) => {
      if (pendingKind) return;
      setPendingKind(kind);
      setStreamText('');
      setUnavailable(null);

      const controller = new AbortController();
      abortRef.current = controller;

      const body = {
        kind,
        ...(activeQuestionId ? { questionId: activeQuestionId } : {}),
        code,
        ...(kind === 'EXPLAIN_TEST_FAILURE' && latestExecutionJobId
          ? { executionJobId: latestExecutionJobId }
          : {}),
        stream: true,
      };

      try {
        let settled = false;
        await streamSse(`/api/ai/interviews/${interviewId}/suggestions/stream`, body, {
          signal: controller.signal,
          onEvent: (event, data) => {
            if (event === 'delta') {
              setStreamText((prev) => prev + ((data as { delta?: string }).delta ?? ''));
            } else if (event === 'result') {
              settled = true;
              const record = data as SuggestionRecord;
              setSuggestions((prev) => [record, ...prev]);
              setStreamText('');
            } else if (event === 'error') {
              settled = true;
              setUnavailable(data as UnavailableBody);
              setStreamText('');
            }
          },
        });
        if (!settled) {
          setUnavailable({
            available: false,
            reason: 'incomplete',
            message: 'The copilot stream ended before a complete response arrived. Try again.',
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setUnavailable({
          available: false,
          reason: 'request_failed',
          message:
            err instanceof ApiError
              ? err.message
              : 'Could not reach the copilot endpoint. Check that the API is running.',
        });
      } finally {
        setPendingKind(null);
        abortRef.current = null;
      }
    },
    [pendingKind, activeQuestionId, code, latestExecutionJobId, interviewId],
  );

  const copyNotes = (record: SuggestionRecord) => {
    const lines: string[] = [record.payload.headline, ''];
    if (record.payload.observations.length) {
      lines.push('Observed:');
      lines.push(...record.payload.observations.map((o) => `- ${o}`));
      lines.push('');
    }
    if (record.payload.suggestions.length) {
      lines.push('Discussed / to discuss:');
      lines.push(...record.payload.suggestions.map((s) => `- ${s.title}: ${s.detail}`));
    }
    onUseAsNote(lines.join('\n').trim());
    toast.info('Copied into the notes box', 'Edit it before saving — it is a draft, not a record.');
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Interviewer copilot</span>
        {aiEnabled ? (
          <Badge tone="neutral">{capabilities?.ai.model ?? ''}</Badge>
        ) : (
          <Badge tone="warning">disabled</Badge>
        )}
      </div>

      <div className={styles.guardrail}>
        {capabilities?.ai.guardrailNotice ??
          'Copilot output is a drafting aid for the interviewer. It does not score candidates and does not make hiring decisions.'}
      </div>

      {!aiEnabled ? (
        <div className={styles.panelScroll}>
          <div style={{ padding: 'var(--space-3)' }}>
            <Callout tone="warning" title="Copilot is not configured">
              {capabilities?.ai.disabledReason ??
                'Set AI_PROVIDER and AI_API_KEY in the environment to enable it.'}{' '}
              No suggestions are generated locally — the panel stays empty rather than showing
              invented output.
            </Callout>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.copilotActions}>
            {ACTIONS.map((action) => (
              <button
                key={action.kind}
                type="button"
                className={styles.copilotButton}
                onClick={() => void request(action.kind)}
                disabled={
                  pendingKind !== null ||
                  (action.kind === 'EXPLAIN_TEST_FAILURE' && !latestExecutionJobId)
                }
                title={
                  action.kind === 'EXPLAIN_TEST_FAILURE' && !latestExecutionJobId
                    ? 'Run the code first so there is a failure to explain'
                    : action.blurb
                }
              >
                <strong style={{ display: 'block', color: 'var(--text-primary)' }}>
                  {pendingKind === action.kind ? '…' : action.label}
                </strong>
                {action.blurb}
              </button>
            ))}
          </div>

          {pendingKind && streamText && (
            <div className={styles.streamBox} aria-live="polite">
              {streamText}
            </div>
          )}

          {pendingKind && !streamText && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-3)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-tertiary)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <Spinner size={12} /> Asking the model…
            </div>
          )}

          <div className={styles.panelScroll}>
            {unavailable && (
              <div style={{ padding: 'var(--space-3)' }}>
                <Callout tone="danger" title="Copilot unavailable">
                  {unavailable.message}
                </Callout>
              </div>
            )}

            {loading ? (
              <div style={{ padding: 'var(--space-4)' }}>
                <Spinner size={16} />
              </div>
            ) : suggestions.length === 0 && !unavailable ? (
              <EmptyState
                icon="◆"
                title="No suggestions yet"
                body="Pick an action above. Everything the copilot returns is split into what it could observe in the code and what it is only inferring."
              />
            ) : (
              suggestions.map((record) => (
                <article key={record.id} className={styles.suggestion}>
                  <header className={styles.suggestionHeader}>
                    <span className={styles.suggestionKind}>
                      {capabilities?.aiSuggestionKinds[record.kind] ?? record.kind}
                    </span>
                    {record.degraded && <Badge tone="warning">unstructured</Badge>}
                    <span className={styles.suggestionTime}>{formatRelative(record.createdAt)}</span>
                  </header>

                  <p className={styles.suggestionHeadline}>{record.payload.headline}</p>

                  {record.degradedReason && (
                    <div style={{ marginBottom: 'var(--space-3)' }}>
                      <Callout tone="warning">{record.degradedReason}</Callout>
                    </div>
                  )}

                  {record.payload.observations.length > 0 && (
                    <div className={styles.group}>
                      <div className={[styles.groupLabel, styles.labelObserved].join(' ')}>
                        Observed
                        <span className={styles.groupHint}>visible in the code or results</span>
                      </div>
                      <ul className={styles.itemList}>
                        {record.payload.observations.map((item, index) => (
                          <li key={index} className={styles.item}>
                            <span className={styles.itemMark} aria-hidden="true">
                              ·
                            </span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {record.payload.assumptions.length > 0 && (
                    <div className={styles.group}>
                      <div className={[styles.groupLabel, styles.labelAssumed].join(' ')}>
                        Assumed
                        <span className={styles.groupHint}>model inference — verify before relying on it</span>
                      </div>
                      <ul className={styles.itemList}>
                        {record.payload.assumptions.map((item, index) => (
                          <li key={index} className={styles.item}>
                            <span className={styles.itemMark} aria-hidden="true">
                              ?
                            </span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {record.payload.suggestions.length > 0 && (
                    <div className={styles.group}>
                      <div className={[styles.groupLabel, styles.labelSuggested].join(' ')}>
                        Suggested next steps
                      </div>
                      <ul className={styles.itemList}>
                        {record.payload.suggestions.map((item, index) => (
                          <li key={index} className={styles.suggestionCard}>
                            <div className={styles.suggestionTitle}>{item.title}</div>
                            <div className={styles.suggestionDetail}>{item.detail}</div>
                            {item.rationale && (
                              <div className={styles.suggestionRationale}>Why: {item.rationale}</div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {record.payload.limitations && (
                    <Callout tone="neutral" title="What it could not determine">
                      {record.payload.limitations}
                    </Callout>
                  )}

                  <footer className={styles.copilotFooter}>
                    <span>{record.model}</span>
                    <span>·</span>
                    <span>
                      {record.usage.promptTokens + record.usage.completionTokens} tokens
                    </span>
                    {record.usage.costUsd > 0 && (
                      <>
                        <span>·</span>
                        <span>{formatUsd(record.usage.costUsd)}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{formatMs(record.usage.latencyMs)}</span>
                    <button
                      type="button"
                      className={styles.copilotButton}
                      style={{ marginInlineStart: 'auto', padding: '2px var(--space-2)' }}
                      onClick={() => copyNotes(record)}
                    >
                      Use as note draft
                    </button>
                  </footer>
                </article>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
