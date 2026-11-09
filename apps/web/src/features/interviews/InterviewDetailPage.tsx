import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button, LinkButton } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Field';
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
  interviewStatusTone,
  LoadingBlock,
} from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatRelative, titleCase } from '../../lib/format';
import { toast } from '../../store/toast';
import styles from './Interviews.module.css';
import type { InterviewDetailDto } from './types';

interface InvitationResult {
  invitationId: string;
  email: string;
  role: string;
  token: string;
  url: string;
  expiresAt: string;
  note: string;
}

export function InterviewDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [interview, setInterview] = useState<InterviewDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'CANDIDATE' | 'INTERVIEWER'>('CANDIDATE');
  const [inviteResult, setInviteResult] = useState<InvitationResult | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInterview(await api.get<InterviewDetailDto>(`/api/interviews/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the interview.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const transition = async (action: 'start' | 'complete') => {
    setBusy(action);
    try {
      await api.post(`/api/interviews/${id}/${action}`);
      toast.success(action === 'start' ? 'Interview started' : 'Interview completed');
      await load();
      if (action === 'start') navigate(`/interviews/${id}/workspace`);
    } catch (err) {
      toast.error(
        'Could not update the interview',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(null);
    }
  };

  const cancelInterview = async () => {
    setBusy('cancel');
    try {
      await api.post(`/api/interviews/${id}/cancel`, {
        ...(cancelReason.trim() ? { reason: cancelReason.trim() } : {}),
      });
      toast.success('Interview cancelled');
      setCancelOpen(false);
      setCancelReason('');
      await load();
    } catch (err) {
      toast.error('Could not cancel', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const sendInvite = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteResult(null);
    try {
      const result = await api.post<InvitationResult>('/api/org/invitations', {
        email: inviteEmail.trim(),
        role: inviteRole,
        interviewId: id,
      });
      setInviteResult(result);
      await load();
    } catch (err) {
      setInviteError(
        err instanceof ApiError ? err.message : 'Could not create the invitation link.',
      );
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = async () => {
    if (!inviteResult) return;
    try {
      await navigator.clipboard.writeText(inviteResult.url);
      toast.success('Link copied');
    } catch {
      toast.warning('Could not copy automatically', 'Select the link and copy it manually.');
    }
  };

  if (loading && !interview) return <LoadingBlock label="Loading interview" />;

  if (error || !interview) {
    return (
      <>
        <PageHeader title="Interview" breadcrumbs={[{ label: 'Interviews', to: '/interviews' }]} />
        <Callout tone="danger" title="Could not load this interview">
          {error ?? 'Not found.'}
        </Callout>
      </>
    );
  }

  const { isStaff, status } = interview;
  const candidate = interview.participants.find((p) => p.role === 'CANDIDATE');
  const interviewers = interview.participants.filter((p) => p.role === 'INTERVIEWER');
  const canStart = isStaff && (status === 'DRAFT' || status === 'SCHEDULED');
  const canComplete = isStaff && status === 'IN_PROGRESS';
  const canCancel = isStaff && !['COMPLETED', 'CANCELLED'].includes(status);

  return (
    <>
      <PageHeader
        title={
          <>
            {interview.title}
            <Badge tone={interviewStatusTone[status] ?? 'neutral'} dot>
              {titleCase(status)}
            </Badge>
          </>
        }
        description={`${titleCase(interview.language)} · ${interview.durationMinutes} minutes · created by ${interview.createdBy.name}`}
        breadcrumbs={[{ label: 'Interviews', to: '/interviews' }, { label: interview.title }]}
        actions={
          <>
            {isStaff && status === 'COMPLETED' && (
              <LinkButton to={`/interviews/${id}/evaluation`} variant="secondary" size="md">
                Evaluation
              </LinkButton>
            )}
            {canCancel && (
              <Button variant="dangerGhost" size="md" onClick={() => setCancelOpen(true)}>
                Cancel
              </Button>
            )}
            {canComplete && (
              <Button
                variant="secondary"
                size="md"
                loading={busy === 'complete'}
                onClick={() => void transition('complete')}
              >
                Mark complete
              </Button>
            )}
            {canStart && (
              <Button
                variant="primary"
                size="md"
                loading={busy === 'start'}
                onClick={() => void transition('start')}
              >
                Start interview
              </Button>
            )}
            {status !== 'CANCELLED' && (
              <LinkButton
                to={`/interviews/${id}/workspace`}
                variant={status === 'IN_PROGRESS' ? 'primary' : 'secondary'}
                size="md"
              >
                Open workspace
              </LinkButton>
            )}
          </>
        }
      />

      {status === 'CANCELLED' && interview.cancelledReason && (
        <Callout tone="warning" title="This interview was cancelled">
          {interview.cancelledReason}
        </Callout>
      )}

      <div className={styles.detailGrid} style={{ marginTop: 'var(--space-2)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <Card>
            <CardHeader
              title="Question set"
              subtitle={`${interview.questions.length} attached, run in this order`}
            />
            {interview.questions.length > 0 ? (
              <div>
                {interview.questions.map((question, index) => (
                  <div key={question.questionId} className={styles.questionRow}>
                    <span className={styles.questionIndex}>{index + 1}</span>
                    <div className={styles.questionBody}>
                      <div className={styles.questionTitle}>{question.title}</div>
                      <div className={styles.questionMeta}>
                        <Badge tone={difficultyTone[question.difficulty] ?? 'neutral'}>
                          {titleCase(question.difficulty)}
                        </Badge>
                        <Badge tone="neutral">
                          {question.testCaseCount} test{question.testCaseCount === 1 ? '' : 's'}
                        </Badge>
                        {question.expectedComplexity && (
                          <Badge tone="info">{question.expectedComplexity}</Badge>
                        )}
                        {question.questionId === interview.activeQuestionId && (
                          <Badge tone="accent" dot>
                            active
                          </Badge>
                        )}
                      </div>
                    </div>
                    {isStaff && (
                      <LinkButton to={`/questions/${question.questionId}`} variant="ghost" size="sm">
                        Edit
                      </LinkButton>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="❑"
                title="No questions attached"
                body="The workspace still works as a shared scratch editor, but there will be no test cases to run."
              />
            )}
          </Card>

          <Card>
            <CardHeader
              title="Participants"
              subtitle={`${interviewers.length} interviewer${interviewers.length === 1 ? '' : 's'}${
                candidate ? ', 1 candidate' : ', no candidate yet'
              }`}
              actions={
                isStaff ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setInviteResult(null);
                      setInviteError(null);
                      setInviteEmail(interview.candidateEmail ?? '');
                      setInviteOpen(true);
                    }}
                  >
                    Invite
                  </Button>
                ) : undefined
              }
            />
            <div>
              {interview.participants.map((participant) => (
                <div key={participant.userId} className={styles.participantRow}>
                  <Avatar
                    name={participant.name}
                    colorIndex={participant.avatarColor}
                    size="md"
                    title={participant.name}
                  />
                  <div className={styles.participantMain}>
                    <div className={styles.participantName}>{participant.name}</div>
                    <div className={styles.participantEmail}>{participant.email}</div>
                  </div>
                  <Badge tone={participant.role === 'CANDIDATE' ? 'accent' : 'neutral'}>
                    {titleCase(participant.role)}
                  </Badge>
                  <span
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-tertiary)',
                      minWidth: 90,
                      textAlign: 'right',
                    }}
                  >
                    {participant.joinedAt ? `joined ${formatRelative(participant.joinedAt)}` : 'not joined'}
                  </span>
                </div>
              ))}
              {interview.participants.length === 0 && (
                <EmptyState icon="◉" title="No participants yet" />
              )}
            </div>
          </Card>

          {isStaff && interview.invitations.length > 0 && (
            <Card>
              <CardHeader title="Pending invitations" subtitle="Links already generated" />
              <div>
                {interview.invitations.map((invitation) => (
                  <div key={invitation.id} className={styles.invitationRow}>
                    <div className={styles.invitationMain}>
                      <div>{invitation.email}</div>
                      <div className={styles.invitationMeta}>
                        {titleCase(invitation.role)} · expires {formatRelative(invitation.expiresAt)}
                      </div>
                    </div>
                    <Badge tone={invitation.acceptedAt ? 'success' : 'warning'} dot>
                      {invitation.acceptedAt ? 'accepted' : 'pending'}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <Card>
            <CardHeader title="Details" />
            <div className={styles.metaList}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Scheduled</span>
                <span className={styles.metaValue}>{formatDateTime(interview.scheduledAt)}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Started</span>
                <span className={styles.metaValue}>{formatDateTime(interview.startedAt)}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Ended</span>
                <span className={styles.metaValue}>{formatDateTime(interview.endedAt)}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Duration</span>
                <span className={styles.metaValue}>{interview.durationMinutes} min</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Language</span>
                <span className={styles.metaValue}>{titleCase(interview.language)}</span>
              </div>
              {interview.difficulty && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Difficulty</span>
                  <span className={styles.metaValue}>{titleCase(interview.difficulty)}</span>
                </div>
              )}
              {interview.candidateEmail && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Candidate email</span>
                  <span className={styles.metaValue}>{interview.candidateEmail}</span>
                </div>
              )}
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Created</span>
                <span className={styles.metaValue}>{formatDateTime(interview.createdAt)}</span>
              </div>
            </div>
          </Card>

          {isStaff && (
            <Card>
              <CardHeader
                title="Private interviewer notes"
                subtitle="Set when the interview was created. Never visible to the candidate."
              />
              <CardBody>
                {interview.privateNotes ? (
                  <p
                    style={{
                      fontSize: 'var(--text-sm)',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {interview.privateNotes}
                  </p>
                ) : (
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                    None. Notes taken during the session live in the workspace panel instead.
                  </p>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite to this interview"
        description="HireFO has no mail transport configured, so it generates a link for you to send yourself."
        footer={
          inviteResult ? (
            <Button variant="primary" onClick={() => setInviteOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={inviting} onClick={() => void sendInvite()}>
                Create link
              </Button>
            </>
          )
        }
      >
        {inviteResult ? (
          <div className={styles.inviteResult}>
            <Callout tone="warning" title="Copy this link now">
              {inviteResult.note}
            </Callout>
            <div className={styles.inviteLink}>
              <input
                className={styles.inviteLinkInput}
                readOnly
                value={inviteResult.url}
                onFocus={(event) => event.target.select()}
                aria-label="Invitation link"
              />
              <Button variant="secondary" onClick={() => void copyInviteLink()}>
                Copy
              </Button>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              For {inviteResult.email} as {titleCase(inviteResult.role)}. Expires{' '}
              {formatDateTime(inviteResult.expiresAt)}.
            </p>
          </div>
        ) : (
          <form
            onSubmit={(event) => void sendInvite(event)}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
          >
            {inviteError && (
              <Callout tone="danger" title="Could not create the link">
                {inviteError}
              </Callout>
            )}
            <Input
              label="Email"
              type="email"
              required
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="candidate@example.com"
            />
            <Select
              label="Role"
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as 'CANDIDATE' | 'INTERVIEWER')}
              hint="Candidates see only this interview. Interviewers need the admin role to invite."
            >
              <option value="CANDIDATE">Candidate</option>
              <option value="INTERVIEWER">Interviewer</option>
            </Select>
          </form>
        )}
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this interview?"
        description="The session can no longer be started and code can no longer be run. This cannot be undone."
        size="sm"
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" loading={busy === 'cancel'} onClick={() => void cancelInterview()}>
              Cancel interview
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason"
          optional
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
          placeholder="Candidate withdrew, rescheduling, …"
          hint="Stored on the interview and shown on this page."
        />
      </Modal>
    </>
  );
}
