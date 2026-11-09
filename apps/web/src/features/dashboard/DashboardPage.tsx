import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { LinkButton } from '../../components/ui/Button';
import {
  Avatar,
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  interviewStatusTone,
  LoadingBlock,
  Stat,
} from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatNumber, formatRelative, formatUsd, titleCase } from '../../lib/format';
import { useAuthStore, useIsStaff } from '../../store/auth';
import { useCapabilitiesStore } from '../../store/capabilities';
import styles from './Dashboard.module.css';

interface Overview {
  interviewsByStatus: Record<string, number>;
  totalInterviews: number;
  activeQuestions: number;
  membersByRole: Record<string, number>;
  codeRunsLast30Days: number;
  ai: { requestsLast30Days: number; costUsdLast30Days: number };
  upcoming: {
    id: string;
    title: string;
    status: string;
    scheduledAt: string | null;
    language: string;
    participants: { userId: string; name: string; role: string }[];
  }[];
  recentlyCompleted: {
    id: string;
    title: string;
    endedAt: string | null;
    evaluationCount: number;
    submittedEvaluationCount: number;
  }[];
}

interface InterviewListResponse {
  total: number;
  items: {
    id: string;
    title: string;
    status: string;
    scheduledAt: string | null;
    language: string;
    participants: { userId: string; name: string; role: string; avatarColor: number }[];
  }[];
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'var(--text-tertiary)',
  SCHEDULED: 'var(--info)',
  IN_PROGRESS: 'var(--accent)',
  COMPLETED: 'var(--success)',
  CANCELLED: 'var(--danger)',
};

const STATUS_ORDER = ['SCHEDULED', 'IN_PROGRESS', 'DRAFT', 'COMPLETED', 'CANCELLED'];

/** Staff see organization-wide figures; candidates see only their own sessions. */
export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const activeOrgId = useAuthStore((s) => s.activeOrgId);
  const isStaff = useIsStaff();
  const capabilities = useCapabilitiesStore((s) => s.data);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [mine, setMine] = useState<InterviewListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        if (isStaff) {
          const [overviewData, mineData] = await Promise.all([
            api.get<Overview>('/api/org/overview'),
            api.get<InterviewListResponse>('/api/interviews?mine=true&pageSize=5'),
          ]);
          if (!cancelled) {
            setOverview(overviewData);
            setMine(mineData);
          }
        } else {
          const mineData = await api.get<InterviewListResponse>('/api/interviews?pageSize=10');
          if (!cancelled) setMine(mineData);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isStaff, activeOrgId]);

  if (loading) return <LoadingBlock label="Loading dashboard" />;

  if (error) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Callout tone="danger" title="Could not load the dashboard">
          {error}
        </Callout>
      </>
    );
  }

  const firstName = user?.name.split(' ')[0] ?? 'there';

  if (!isStaff) {
    return (
      <>
        <PageHeader
          title={`Welcome, ${firstName}`}
          description="Your interviews appear below. Open one when it is time to start — the interviewer will be in the same workspace."
        />
        <Card>
          <CardHeader title="Your interviews" subtitle={`${mine?.total ?? 0} total`} />
          {mine && mine.items.length > 0 ? (
            <div className={styles.list}>
              {mine.items.map((interview) => (
                <Link key={interview.id} to={`/interviews/${interview.id}`} className={styles.row}>
                  <div className={styles.rowMain}>
                    <div className={styles.rowTitle}>{interview.title}</div>
                    <div className={styles.rowMeta}>
                      <span>{titleCase(interview.language)}</span>
                      <span>·</span>
                      <span>
                        {interview.scheduledAt
                          ? `Scheduled ${formatRelative(interview.scheduledAt)}`
                          : 'Not scheduled yet'}
                      </span>
                    </div>
                  </div>
                  <Badge tone={interviewStatusTone[interview.status] ?? 'neutral'} dot>
                    {titleCase(interview.status)}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="▤"
              title="No interviews yet"
              body="When an interviewer schedules a session with you it will show up here."
            />
          )}
        </Card>
      </>
    );
  }

  const statusTotal = Math.max(
    1,
    Object.values(overview?.interviewsByStatus ?? {}).reduce((sum, n) => sum + n, 0),
  );

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Everything below is counted from real records in this organization."
        actions={
          <>
            <LinkButton to="/questions/new" variant="secondary" size="md">
              New question
            </LinkButton>
            <LinkButton to="/interviews/new" variant="primary" size="md">
              New interview
            </LinkButton>
          </>
        }
      />

      <div className={styles.statGrid}>
        <Stat
          label="Interviews"
          value={formatNumber(overview?.totalInterviews ?? 0)}
          hint={`${overview?.interviewsByStatus['IN_PROGRESS'] ?? 0} in progress`}
        />
        <Stat
          label="Active questions"
          value={formatNumber(overview?.activeQuestions ?? 0)}
          hint="in the library"
        />
        <Stat
          label="Code runs"
          value={formatNumber(overview?.codeRunsLast30Days ?? 0)}
          hint="last 30 days"
        />
        <Stat
          label="Team members"
          value={formatNumber(
            Object.values(overview?.membersByRole ?? {}).reduce((sum, n) => sum + n, 0),
          )}
          hint={`${overview?.membersByRole['INTERVIEWER'] ?? 0} interviewers`}
        />
        <Stat
          label="Copilot spend"
          value={
            capabilities?.ai.enabled ? formatUsd(overview?.ai.costUsdLast30Days ?? 0) : 'Disabled'
          }
          hint={
            capabilities?.ai.enabled
              ? `${formatNumber(overview?.ai.requestsLast30Days ?? 0)} requests, 30 days`
              : 'AI_PROVIDER is not configured'
          }
        />
      </div>

      <div className={styles.columns}>
        <Card>
          <CardHeader
            title="Upcoming and live"
            subtitle="Scheduled or in progress"
            actions={
              <LinkButton to="/interviews" variant="secondary" size="sm">
                View all
              </LinkButton>
            }
          />
          {overview && overview.upcoming.length > 0 ? (
            <div className={styles.list}>
              {overview.upcoming.map((interview) => (
                <Link key={interview.id} to={`/interviews/${interview.id}`} className={styles.row}>
                  <div className={styles.rowMain}>
                    <div className={styles.rowTitle}>{interview.title}</div>
                    <div className={styles.rowMeta}>
                      <span>{titleCase(interview.language)}</span>
                      <span>·</span>
                      <span>
                        {interview.scheduledAt
                          ? formatRelative(interview.scheduledAt)
                          : 'no date set'}
                      </span>
                      <span>·</span>
                      <span>
                        {interview.participants.filter((p) => p.role === 'CANDIDATE').length
                          ? `candidate: ${
                              interview.participants.find((p) => p.role === 'CANDIDATE')?.name
                            }`
                          : 'no candidate yet'}
                      </span>
                    </div>
                  </div>
                  <Badge tone={interviewStatusTone[interview.status] ?? 'neutral'} dot>
                    {titleCase(interview.status)}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="▤"
              title="Nothing scheduled"
              body="Create an interview, attach a question or two, then invite the candidate."
              actions={
                <LinkButton to="/interviews/new" variant="primary" size="sm">
                  New interview
                </LinkButton>
              }
            />
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <Card>
            <CardHeader title="By status" subtitle="All interviews" />
            {overview && overview.totalInterviews > 0 ? (
              <div className={styles.statusBreakdown}>
                {STATUS_ORDER.filter((status) => overview.interviewsByStatus[status]).map(
                  (status) => {
                    const count = overview.interviewsByStatus[status] ?? 0;
                    return (
                      <div key={status} className={styles.breakdownRow}>
                        <span className={styles.breakdownLabel}>{titleCase(status)}</span>
                        <span className={styles.breakdownTrack}>
                          <span
                            className={styles.breakdownFill}
                            style={{
                              width: `${(count / statusTotal) * 100}%`,
                              background: STATUS_COLOR[status],
                            }}
                          />
                        </span>
                        <span className={styles.breakdownCount}>{count}</span>
                      </div>
                    );
                  },
                )}
              </div>
            ) : (
              <EmptyState icon="▦" title="No data yet" body="Status counts appear once you create interviews." />
            )}
          </Card>

          <Card>
            <CardHeader title="Recently completed" subtitle="Awaiting or holding evaluations" />
            {overview && overview.recentlyCompleted.length > 0 ? (
              <div className={styles.list}>
                {overview.recentlyCompleted.map((interview) => (
                  <Link
                    key={interview.id}
                    to={`/interviews/${interview.id}/evaluation`}
                    className={styles.row}
                  >
                    <div className={styles.rowMain}>
                      <div className={styles.rowTitle}>{interview.title}</div>
                      <div className={styles.rowMeta}>
                        <span>ended {formatRelative(interview.endedAt)}</span>
                      </div>
                    </div>
                    <Badge
                      tone={interview.submittedEvaluationCount > 0 ? 'success' : 'warning'}
                      dot
                    >
                      {interview.submittedEvaluationCount > 0
                        ? `${interview.submittedEvaluationCount} submitted`
                        : 'evaluation pending'}
                    </Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="✓"
                title="Nothing completed yet"
                body="Completed interviews and their evaluation status appear here."
              />
            )}
          </Card>
        </div>
      </div>

      {mine && mine.items.length > 0 && (
        <Card style={{ marginTop: 'var(--space-5)' }}>
          <CardHeader title="Your sessions" subtitle="Interviews you are assigned to" />
          <div className={styles.list}>
            {mine.items.map((interview) => (
              <Link key={interview.id} to={`/interviews/${interview.id}`} className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTitle}>{interview.title}</div>
                  <div className={styles.rowMeta}>
                    <span>{titleCase(interview.language)}</span>
                    <span>·</span>
                    <span>
                      {interview.scheduledAt ? formatRelative(interview.scheduledAt) : 'no date set'}
                    </span>
                  </div>
                </div>
                <div className={styles.avatars}>
                  {interview.participants.slice(0, 4).map((p) => (
                    <Avatar
                      key={p.userId}
                      name={p.name}
                      colorIndex={p.avatarColor}
                      size="sm"
                      ring
                      title={`${p.name} (${p.role.toLowerCase()})`}
                    />
                  ))}
                </div>
                <Badge tone={interviewStatusTone[interview.status] ?? 'neutral'} dot>
                  {titleCase(interview.status)}
                </Badge>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
