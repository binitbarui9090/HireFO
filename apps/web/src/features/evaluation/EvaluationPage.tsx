import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { RECOMMENDATIONS, type Recommendation, type RubricCriterion } from '@hirefo/shared';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button, LinkButton } from '../../components/ui/Button';
import { Select, Textarea } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import {
  Avatar,
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  difficultyTone,
  EmptyState,
  executionStatusTone,
  LoadingBlock,
  Stat,
} from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatMs, formatNumber, formatUsd, titleCase } from '../../lib/format';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import styles from './Evaluation.module.css';

interface Analytics {
  disclaimer: string;
  interview: {
    id: string;
    title: string;
    status: string;
    language: string;
    scheduledAt: string | null;
    startedAt: string | null;
    endedAt: string | null;
    durationMinutes: number;
    elapsedMinutes: number | null;
  };
  participants: { userId: string; name: string; email: string; role: string; joinedAt: string | null }[];
  activity: {
    questionsAttached: number;
    questionsCompleted: number;
    totalRuns: number;
    runsByKind: { RUN: number; SUBMIT: number };
    executionStatusCounts: Record<string, number>;
    totalTestsRun: number;
    totalTestsPassed: number;
    medianExecutionMs: number | null;
    noteCount: number;
    privateNoteCount: number;
    aiSuggestionCount: number;
    aiCostUsd: number;
  };
  perQuestion: {
    questionId: string;
    title: string;
    difficulty: string;
    totalTestCases: number;
    runCount: number;
    submitCount: number;
    bestPassed: number;
    bestTotal: number;
    completed: boolean;
    firstRunAt: string | null;
    lastRunAt: string | null;
  }[];
  evaluations: {
    id: string;
    author: { id: string; name: string };
    recommendation: Recommendation | null;
    submittedAt: string | null;
    updatedAt: string;
    hasSummary: boolean;
  }[];
}

interface RubricDto {
  id: string;
  name: string;
  description: string | null;
  criteria: RubricCriterion[];
  isDefault: boolean;
}

interface EvaluationDto {
  id: string;
  authorId: string;
  rubricId: string | null;
  scores: Record<string, number>;
  strengths: string;
  concerns: string;
  communicationObservations: string;
  problemSolvingObservations: string;
  summary: string;
  recommendation: Recommendation | null;
  submittedAt: string | null;
  updatedAt: string;
  author: { id: string; name: string; avatarColor: number };
  rubric: { id: string; name: string; criteria: RubricCriterion[] } | null;
}

interface NoteDto {
  id: string;
  body: string;
  isPrivate: boolean;
  createdAt: string;
  author: { id: string; name: string; avatarColor: number };
  question?: { id: string; title: string } | null;
}

export function EvaluationPage() {
  const { id = '' } = useParams<{ id: string }>();
  const currentUser = useAuthStore((s) => s.user);

  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [rubrics, setRubrics] = useState<RubricDto[]>([]);
  const [evaluations, setEvaluations] = useState<EvaluationDto[]>([]);
  const [notes, setNotes] = useState<NoteDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [rubricId, setRubricId] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [strengths, setStrengths] = useState('');
  const [concerns, setConcerns] = useState('');
  const [communication, setCommunication] = useState('');
  const [problemSolving, setProblemSolving] = useState('');
  const [summary, setSummary] = useState('');
  const [recommendation, setRecommendation] = useState<Recommendation | ''>('');

  const [saving, setSaving] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [analyticsData, rubricData, evaluationData, noteData] = await Promise.all([
        api.get<Analytics>(`/api/interviews/${id}/analytics`),
        api.get<{ items: RubricDto[] }>('/api/org/rubrics'),
        api.get<{ items: EvaluationDto[] }>(`/api/interviews/${id}/evaluations`),
        api.get<{ items: NoteDto[] }>(`/api/interviews/${id}/notes`),
      ]);

      setAnalytics(analyticsData);
      setRubrics(rubricData.items);
      setEvaluations(evaluationData.items);
      setNotes(noteData.items);

      const own = evaluationData.items.find((e) => e.authorId === currentUser?.id);
      const defaultRubric = rubricData.items.find((r) => r.isDefault) ?? rubricData.items[0];
      setRubricId(own?.rubricId ?? defaultRubric?.id ?? '');
      setScores(own?.scores ?? {});
      setStrengths(own?.strengths ?? '');
      setConcerns(own?.concerns ?? '');
      setCommunication(own?.communicationObservations ?? '');
      setProblemSolving(own?.problemSolvingObservations ?? '');
      setSummary(own?.summary ?? '');
      setRecommendation(own?.recommendation ?? '');
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load the evaluation.');
    } finally {
      setLoading(false);
    }
  }, [id, currentUser?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const own = evaluations.find((e) => e.authorId === currentUser?.id) ?? null;
  const locked = Boolean(own?.submittedAt);
  const activeRubric = rubrics.find((r) => r.id === rubricId) ?? null;

  const persist = async (submit: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/api/interviews/${id}/evaluation`, {
        ...(rubricId ? { rubricId } : {}),
        scores,
        strengths,
        concerns,
        communicationObservations: communication,
        problemSolvingObservations: problemSolving,
        summary,
        ...(recommendation ? { recommendation } : {}),
        submit,
      });
      toast.success(submit ? 'Evaluation submitted' : 'Draft saved');
      setConfirmSubmit(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the evaluation.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading evaluation" />;

  if (loadError || !analytics) {
    return (
      <>
        <PageHeader title="Evaluation" breadcrumbs={[{ label: 'Interviews', to: '/interviews' }]} />
        <Callout tone="danger" title="Could not load this evaluation">
          {loadError ?? 'Not found.'}
        </Callout>
      </>
    );
  }

  const { activity } = analytics;
  const passRate =
    activity.totalTestsRun > 0
      ? Math.round((activity.totalTestsPassed / activity.totalTestsRun) * 100)
      : null;

  return (
    <>
      <PageHeader
        title="Evaluation"
        description={analytics.interview.title}
        breadcrumbs={[
          { label: 'Interviews', to: '/interviews' },
          { label: analytics.interview.title, to: `/interviews/${id}` },
          { label: 'Evaluation' },
        ]}
        actions={
          <LinkButton to={`/interviews/${id}`} variant="ghost" size="md">
            Interview details
          </LinkButton>
        }
      />

      <Callout tone="info" title="How to read this page">
        {analytics.disclaimer}
      </Callout>

      <div className={styles.statGrid}>
        <Stat
          label="Questions completed"
          value={`${activity.questionsCompleted}/${activity.questionsAttached}`}
          hint="all cases passed on a Submit run"
        />
        <Stat
          label="Test cases passed"
          value={passRate === null ? '—' : `${passRate}%`}
          hint={`${formatNumber(activity.totalTestsPassed)} of ${formatNumber(activity.totalTestsRun)} evaluated`}
        />
        <Stat
          label="Code runs"
          value={formatNumber(activity.totalRuns)}
          hint={`${activity.runsByKind.RUN} run · ${activity.runsByKind.SUBMIT} submit`}
        />
        <Stat
          label="Session length"
          value={
            analytics.interview.elapsedMinutes !== null
              ? `${analytics.interview.elapsedMinutes} min`
              : '—'
          }
          hint={`scheduled for ${analytics.interview.durationMinutes} min`}
        />
        <Stat
          label="Median run time"
          value={formatMs(activity.medianExecutionMs)}
          hint="wall clock, per execution"
        />
        <Stat
          label="Interviewer notes"
          value={formatNumber(activity.noteCount)}
          hint={`${activity.privateNoteCount} private`}
        />
      </div>

      <div className={styles.columns}>
        <div className={styles.mainColumn}>
          <Card>
            <CardHeader
              title="Your evaluation"
              subtitle={
                locked
                  ? `Submitted ${formatDateTime(own?.submittedAt)} — read-only`
                  : 'Saved as a draft until you submit it'
              }
              actions={locked ? <Badge tone="success">submitted</Badge> : undefined}
            />
            <CardBody>
              <div className={styles.form}>
                {error && (
                  <Callout tone="danger" title="Could not save">
                    {error}
                  </Callout>
                )}

                {locked && (
                  <Callout tone="neutral">
                    A submitted evaluation cannot be edited. This is deliberate: the written
                    assessment is the record of what you concluded at the time.
                  </Callout>
                )}

                {rubrics.length > 1 && !locked && (
                  <Select
                    label="Rubric"
                    value={rubricId}
                    onChange={(event) => {
                      setRubricId(event.target.value);
                      setScores({});
                    }}
                  >
                    {rubrics.map((rubric) => (
                      <option key={rubric.id} value={rubric.id}>
                        {rubric.name}
                        {rubric.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </Select>
                )}

                {activeRubric ? (
                  <div>
                    <div className={styles.sectionLabel}>{activeRubric.name}</div>
                    {activeRubric.description && (
                      <p className={styles.sectionHint}>{activeRubric.description}</p>
                    )}
                    <div className={styles.rubricList}>
                      {activeRubric.criteria.map((criterion) => {
                        const value = scores[criterion.key];
                        return (
                          <div key={criterion.key} className={styles.rubricRow}>
                            <div className={styles.rubricLabel}>
                              <span className={styles.rubricName}>{criterion.label}</span>
                              {criterion.description && (
                                <span className={styles.rubricDescription}>
                                  {criterion.description}
                                </span>
                              )}
                            </div>
                            <div
                              className={styles.scoreGroup}
                              role="radiogroup"
                              aria-label={criterion.label}
                            >
                              {Array.from({ length: criterion.maxScore }, (_, i) => i + 1).map(
                                (score) => (
                                  <button
                                    key={score}
                                    type="button"
                                    role="radio"
                                    aria-checked={value === score}
                                    disabled={locked}
                                    className={[
                                      styles.scoreButton,
                                      value === score ? styles.scoreButtonActive : '',
                                    ]
                                      .filter(Boolean)
                                      .join(' ')}
                                    onClick={() =>
                                      setScores((prev) =>
                                        prev[criterion.key] === score
                                          ? Object.fromEntries(
                                              Object.entries(prev).filter(
                                                ([key]) => key !== criterion.key,
                                              ),
                                            )
                                          : { ...prev, [criterion.key]: score },
                                      )
                                    }
                                  >
                                    {score}
                                  </button>
                                ),
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <Callout tone="warning" title="No rubric configured">
                    An admin can add one under Team & invites. You can still write the narrative
                    sections below.
                  </Callout>
                )}

                <Textarea
                  label="Problem-solving observations"
                  value={problemSolving}
                  onChange={(event) => setProblemSolving(event.target.value)}
                  disabled={locked}
                  placeholder="How they decomposed the problem, where they got stuck, how they recovered."
                  style={{ minHeight: 100 }}
                />
                <Textarea
                  label="Communication observations"
                  value={communication}
                  onChange={(event) => setCommunication(event.target.value)}
                  disabled={locked}
                  placeholder="What they explained, how they responded to questions and hints."
                  hint="Your observation, entered by you. Nothing here is inferred by the system."
                  style={{ minHeight: 100 }}
                />
                <div className={styles.twoUp}>
                  <Textarea
                    label="Strengths"
                    value={strengths}
                    onChange={(event) => setStrengths(event.target.value)}
                    disabled={locked}
                    style={{ minHeight: 100 }}
                  />
                  <Textarea
                    label="Concerns"
                    value={concerns}
                    onChange={(event) => setConcerns(event.target.value)}
                    disabled={locked}
                    style={{ minHeight: 100 }}
                  />
                </div>
                <Textarea
                  label="Summary"
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  disabled={locked}
                  placeholder="Your overall written assessment. This is the record."
                  style={{ minHeight: 140 }}
                />
                <Select
                  label="Recommendation"
                  value={recommendation}
                  onChange={(event) => setRecommendation(event.target.value as Recommendation | '')}
                  disabled={locked}
                  hint="Your judgement. The copilot never produces or influences this field."
                >
                  <option value="">Not stated</option>
                  {RECOMMENDATIONS.map((r) => (
                    <option key={r} value={r}>
                      {titleCase(r)}
                    </option>
                  ))}
                </Select>

                {!locked && (
                  <div className={styles.formActions}>
                    <Button
                      type="button"
                      variant="secondary"
                      loading={saving}
                      onClick={() => void persist(false)}
                    >
                      Save draft
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={saving || !summary.trim()}
                      onClick={() => setConfirmSubmit(true)}
                      title={!summary.trim() ? 'Write a summary before submitting' : undefined}
                    >
                      Submit evaluation
                    </Button>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Per-question activity" subtitle="Counts, not scores" />
            {analytics.perQuestion.length > 0 ? (
              <div>
                {analytics.perQuestion.map((question) => (
                  <div key={question.questionId} className={styles.questionRow}>
                    <div className={styles.questionMain}>
                      <div className={styles.questionTitle}>{question.title}</div>
                      <div className={styles.questionMeta}>
                        <Badge tone={difficultyTone[question.difficulty] ?? 'neutral'}>
                          {titleCase(question.difficulty)}
                        </Badge>
                        <span>
                          {question.runCount} run{question.runCount === 1 ? '' : 's'}
                        </span>
                        <span>·</span>
                        <span>
                          {question.submitCount} submit{question.submitCount === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                    <div className={styles.questionScore}>
                      <span className={styles.questionScoreValue}>
                        {question.bestTotal > 0
                          ? `${question.bestPassed}/${question.bestTotal}`
                          : '—'}
                      </span>
                      <span className={styles.questionScoreLabel}>best run</span>
                    </div>
                    <Badge tone={question.completed ? 'success' : 'neutral'} dot>
                      {question.completed ? 'all passed' : 'incomplete'}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="❑" title="No questions were attached" />
            )}
          </Card>

          <Card>
            <CardHeader
              title="Interviewer notes"
              subtitle={`${notes.length} recorded during the session`}
            />
            {notes.length > 0 ? (
              <div>
                {notes.map((note) => (
                  <div key={note.id} className={styles.noteRow}>
                    <div className={styles.noteMeta}>
                      <Avatar name={note.author.name} colorIndex={note.author.avatarColor} size="sm" />
                      <span className={styles.noteAuthor}>{note.author.name}</span>
                      <span>{formatDateTime(note.createdAt)}</span>
                      {note.isPrivate && <Badge tone="warning">private</Badge>}
                      {note.question && <Badge tone="neutral">{note.question.title}</Badge>}
                    </div>
                    <p className={styles.noteBody}>{note.body}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="✎"
                title="No notes were taken"
                body="Notes are written from the workspace panel during the interview."
              />
            )}
          </Card>
        </div>

        <div className={styles.sideColumn}>
          <Card>
            <CardHeader title="Session" />
            <div className={styles.metaList}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Status</span>
                <span className={styles.metaValue}>{titleCase(analytics.interview.status)}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Language</span>
                <span className={styles.metaValue}>{titleCase(analytics.interview.language)}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Started</span>
                <span className={styles.metaValue}>{formatDateTime(analytics.interview.startedAt)}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Ended</span>
                <span className={styles.metaValue}>{formatDateTime(analytics.interview.endedAt)}</span>
              </div>
              {analytics.activity.aiSuggestionCount > 0 && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Copilot</span>
                  <span className={styles.metaValue}>
                    {analytics.activity.aiSuggestionCount} requests ·{' '}
                    {formatUsd(analytics.activity.aiCostUsd)}
                  </span>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Execution outcomes" subtitle="Status of every queued job" />
            <div className={styles.metaList}>
              {Object.entries(activity.executionStatusCounts).length > 0 ? (
                Object.entries(activity.executionStatusCounts).map(([status, count]) => (
                  <div key={status} className={styles.metaRow}>
                    <Badge tone={executionStatusTone[status] ?? 'neutral'} dot>
                      {titleCase(status)}
                    </Badge>
                    <span className={styles.metaValue}>{count}</span>
                  </div>
                ))
              ) : (
                <span className={styles.sectionHint}>No code was executed.</span>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Participants" />
            <div>
              {analytics.participants.map((participant) => (
                <div key={participant.userId} className={styles.participantRow}>
                  <div className={styles.participantMain}>
                    <div className={styles.participantName}>{participant.name}</div>
                    <div className={styles.participantEmail}>{participant.email}</div>
                  </div>
                  <Badge tone={participant.role === 'CANDIDATE' ? 'accent' : 'neutral'}>
                    {titleCase(participant.role)}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>

          {analytics.evaluations.length > 0 && (
            <Card>
              <CardHeader title="All evaluations" subtitle="One per interviewer" />
              <div>
                {analytics.evaluations.map((evaluation) => (
                  <div key={evaluation.id} className={styles.participantRow}>
                    <div className={styles.participantMain}>
                      <div className={styles.participantName}>{evaluation.author.name}</div>
                      <div className={styles.participantEmail}>
                        {evaluation.submittedAt
                          ? `submitted ${formatDateTime(evaluation.submittedAt)}`
                          : 'draft'}
                      </div>
                    </div>
                    {evaluation.recommendation ? (
                      <Badge
                        tone={
                          evaluation.recommendation.includes('YES')
                            ? 'success'
                            : evaluation.recommendation.includes('NO')
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {titleCase(evaluation.recommendation)}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">no recommendation</Badge>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        title="Submit this evaluation?"
        description="Once submitted it becomes read-only. You will not be able to change the scores, the narrative or the recommendation."
        size="sm"
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSubmit(false)}>
              Keep editing
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void persist(true)}>
              Submit
            </Button>
          </>
        }
      >
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          {recommendation
            ? `Your recommendation is "${titleCase(recommendation)}".`
            : 'You have not stated a recommendation. That is allowed — the written summary is the record.'}
        </p>
      </Modal>
    </>
  );
}
