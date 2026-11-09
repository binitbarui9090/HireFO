import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DIFFICULTIES } from '@hirefo/shared';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button, LinkButton } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Field';
import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  difficultyTone,
  EmptyState,
  LoadingBlock,
} from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { titleCase } from '../../lib/format';
import { useCapabilitiesStore } from '../../store/capabilities';
import { toast } from '../../store/toast';
import styles from './Interviews.module.css';
import type { MemberDto, Paged, QuestionSummaryDto } from './types';

export function InterviewCreatePage() {
  const navigate = useNavigate();
  const capabilities = useCapabilitiesStore((s) => s.data);

  const [questions, setQuestions] = useState<QuestionSummaryDto[] | null>(null);
  const [members, setMembers] = useState<MemberDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [interviewerIds, setInterviewerIds] = useState<string[]>([]);
  const [candidateUserId, setCandidateUserId] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [privateNotes, setPrivateNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    (async () => {
      try {
        const [questionData, memberData] = await Promise.all([
          api.get<Paged<QuestionSummaryDto>>('/api/questions?pageSize=100'),
          api.get<{ items: MemberDto[] }>('/api/org/members'),
        ]);
        setQuestions(questionData.items);
        setMembers(memberData.items);
      } catch (err) {
        setLoadError(
          err instanceof ApiError ? err.message : 'Could not load the question library or team.',
        );
      }
    })();
  }, []);

  // Default the language to the first executable one the backend reports.
  useEffect(() => {
    if (!language && capabilities?.languages.length) {
      setLanguage(capabilities.languages.find((l) => l.executable)?.id ?? capabilities.languages[0]!.id);
    }
  }, [capabilities, language]);

  const availableQuestions = useMemo(
    () => (questions ?? []).filter((q) => !language || q.languages.includes(language)),
    [questions, language],
  );

  const staff = useMemo(
    () => (members ?? []).filter((m) => m.role !== 'CANDIDATE' && m.status === 'ACTIVE'),
    [members],
  );
  const candidates = useMemo(
    () => (members ?? []).filter((m) => m.role === 'CANDIDATE' && m.status === 'ACTIVE'),
    [members],
  );

  const toggleQuestion = (id: string) =>
    setSelectedQuestionIds((prev) =>
      prev.includes(id) ? prev.filter((q) => q !== id) : [...prev, id],
    );

  const toggleInterviewer = (id: string) =>
    setInterviewerIds((prev) => (prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]));

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const created = await api.post<{ id: string }>('/api/interviews', {
        title,
        language,
        durationMinutes,
        ...(difficulty ? { difficulty } : {}),
        ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
        questionIds: selectedQuestionIds,
        interviewerIds,
        ...(candidateUserId ? { candidateUserId } : {}),
        ...(candidateEmail.trim() ? { candidateEmail: candidateEmail.trim() } : {}),
        ...(privateNotes.trim() ? { privateNotes: privateNotes.trim() } : {}),
      });
      toast.success('Interview created', 'Invite the candidate from the interview page.');
      navigate(`/interviews/${created.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors ?? {});
      } else {
        setError('Could not create the interview.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const serverError = (field: string) => fieldErrors[field]?.[0] ?? null;

  if (loadError) {
    return (
      <>
        <PageHeader title="New interview" breadcrumbs={[{ label: 'Interviews', to: '/interviews' }]} />
        <Callout tone="danger" title="Could not load required data">
          {loadError}
        </Callout>
      </>
    );
  }

  if (!questions || !members) return <LoadingBlock label="Loading question library" />;

  return (
    <>
      <PageHeader
        title="New interview"
        description="Pick the language and the questions now; you can still change them before the session starts."
        breadcrumbs={[{ label: 'Interviews', to: '/interviews' }, { label: 'New' }]}
      />

      <form onSubmit={onSubmit} noValidate>
        <div className={styles.formGrid}>
          {error && (
            <Callout tone="danger" title="Could not create the interview">
              {error}
            </Callout>
          )}

          <Card>
            <CardHeader title="Basics" />
            <CardBody>
              <div className={styles.formGrid}>
                <Input
                  label="Title"
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Senior Frontend — technical round"
                  error={serverError('title')}
                />

                <div className={styles.formRow}>
                  <Select
                    label="Language"
                    required
                    value={language}
                    onChange={(event) => {
                      setLanguage(event.target.value);
                      setSelectedQuestionIds([]);
                    }}
                    error={serverError('language')}
                    hint={
                      capabilities?.languages.find((l) => l.id === language)?.executionNote ?? undefined
                    }
                  >
                    {capabilities?.languages.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                        {l.executable ? '' : ' — not executable'}
                      </option>
                    ))}
                  </Select>

                  <Select
                    label="Difficulty"
                    optional
                    value={difficulty}
                    onChange={(event) => setDifficulty(event.target.value)}
                    hint="A label for your own filtering; it does not change the questions."
                  >
                    <option value="">Not set</option>
                    {DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>
                        {titleCase(d)}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className={styles.formRow}>
                  <Input
                    label="Scheduled start"
                    type="datetime-local"
                    optional
                    value={scheduledAt}
                    onChange={(event) => setScheduledAt(event.target.value)}
                    hint="Leave blank to keep the interview as a draft."
                  />
                  <Input
                    label="Duration (minutes)"
                    type="number"
                    min={10}
                    max={480}
                    required
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(Number(event.target.value))}
                    error={serverError('durationMinutes')}
                    hint="Drives the workspace timer. It does not cut the session off."
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Question set"
              subtitle={
                availableQuestions.length
                  ? `${selectedQuestionIds.length} selected · click to add, click again to remove`
                  : undefined
              }
              actions={
                <LinkButton to="/questions/new" variant="secondary" size="sm">
                  New question
                </LinkButton>
              }
            />
            <CardBody>
              {availableQuestions.length === 0 ? (
                <EmptyState
                  icon="❑"
                  title={
                    questions.length === 0
                      ? 'The question library is empty'
                      : `No questions support ${titleCase(language)}`
                  }
                  body={
                    questions.length === 0
                      ? 'Add a question with test cases first, then attach it here.'
                      : 'Pick another language, or add a question that supports this one.'
                  }
                  actions={
                    <LinkButton to="/questions/new" variant="primary" size="sm">
                      Create a question
                    </LinkButton>
                  }
                />
              ) : (
                <div className={styles.questionPicker}>
                  {availableQuestions.map((question) => {
                    const order = selectedQuestionIds.indexOf(question.id);
                    const selected = order !== -1;
                    return (
                      <div
                        key={question.id}
                        role="checkbox"
                        aria-checked={selected}
                        tabIndex={0}
                        className={[styles.pickerRow, selected ? styles.pickerRowSelected : '']
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => toggleQuestion(question.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleQuestion(question.id);
                          }
                        }}
                      >
                        <span className={styles.pickerOrder}>{selected ? order + 1 : ''}</span>
                        <div className={styles.pickerMain}>
                          <div className={styles.pickerTitle}>{question.title}</div>
                          <div className={styles.pickerMeta}>
                            <Badge tone={difficultyTone[question.difficulty] ?? 'neutral'}>
                              {titleCase(question.difficulty)}
                            </Badge>
                            <span>
                              {question.testCaseCount} test{question.testCaseCount === 1 ? '' : 's'}
                            </span>
                            {question.testCaseCount === 0 && (
                              <Badge tone="warning">no tests</Badge>
                            )}
                            <span>{question.categories.map(titleCase).join(', ')}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="People" subtitle="You are added as an interviewer automatically" />
            <CardBody>
              <div className={styles.formGrid}>
                {staff.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 'var(--weight-medium)',
                        color: 'var(--text-secondary)',
                        marginBottom: 'var(--space-2)',
                      }}
                    >
                      Additional interviewers
                    </div>
                    <div className={styles.questionPicker} style={{ maxHeight: 180 }}>
                      {staff.map((member) => {
                        const selected = interviewerIds.includes(member.userId);
                        return (
                          <div
                            key={member.userId}
                            role="checkbox"
                            aria-checked={selected}
                            tabIndex={0}
                            className={[styles.pickerRow, selected ? styles.pickerRowSelected : '']
                              .filter(Boolean)
                              .join(' ')}
                            onClick={() => toggleInterviewer(member.userId)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                toggleInterviewer(member.userId);
                              }
                            }}
                          >
                            <span className={styles.pickerOrder}>{selected ? '✓' : ''}</span>
                            <div className={styles.pickerMain}>
                              <div className={styles.pickerTitle}>{member.name}</div>
                              <div className={styles.pickerMeta}>
                                <span>{member.email}</span>
                                <Badge tone="neutral">{titleCase(member.role)}</Badge>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className={styles.formRow}>
                  <Select
                    label="Candidate (existing member)"
                    optional
                    value={candidateUserId}
                    onChange={(event) => setCandidateUserId(event.target.value)}
                    hint={
                      candidates.length
                        ? 'Pick someone who already accepted an invitation.'
                        : 'No candidate accounts yet — use the email field and send an invite instead.'
                    }
                  >
                    <option value="">Not selected</option>
                    {candidates.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.name} · {member.email}
                      </option>
                    ))}
                  </Select>

                  <Input
                    label="Candidate email"
                    type="email"
                    optional
                    value={candidateEmail}
                    onChange={(event) => setCandidateEmail(event.target.value)}
                    error={serverError('candidateEmail')}
                    hint="Recorded on the interview so you can send the invite link afterwards."
                  />
                </div>

                <Textarea
                  label="Private interviewer notes"
                  optional
                  value={privateNotes}
                  onChange={(event) => setPrivateNotes(event.target.value)}
                  placeholder="What you want to probe, context from the CV, anything the candidate should not see."
                  hint="Never shown to the candidate."
                />
              </div>
            </CardBody>
          </Card>

          <div className={styles.formActions}>
            <LinkButton to="/interviews" variant="ghost" size="md">
              Cancel
            </LinkButton>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={submitting}
              disabled={!title.trim() || !language}
            >
              Create interview
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
