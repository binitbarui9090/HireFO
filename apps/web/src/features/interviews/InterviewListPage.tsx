import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { INTERVIEW_STATUSES } from '@hirefo/shared';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button, LinkButton } from '../../components/ui/Button';
import {
  Avatar,
  Badge,
  Callout,
  Card,
  EmptyState,
  interviewStatusTone,
  LoadingBlock,
} from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatRelative, pluralise, titleCase } from '../../lib/format';
import { useAuthStore, useIsStaff } from '../../store/auth';
import styles from './Interviews.module.css';
import type { InterviewSummaryDto, Paged } from './types';

const PAGE_SIZE = 20;

export function InterviewListPage() {
  const isStaff = useIsStaff();
  const activeOrgId = useAuthStore((s) => s.activeOrgId);

  const [data, setData] = useState<Paged<InterviewSummaryDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (status) params.set('status', status);
    if (mineOnly) params.set('mine', 'true');

    try {
      setData(await api.get<Paged<InterviewSummaryDto>>(`/api/interviews?${params.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load interviews.');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status, mineOnly]);

  useEffect(() => {
    void load();
  }, [load, activeOrgId]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Interviews"
        description={
          isStaff
            ? 'Every interview in this organization. Open one to manage its question set, invite the candidate, or jump into the workspace.'
            : 'The interviews you are taking part in.'
        }
        actions={
          isStaff ? (
            <LinkButton to="/interviews/new" variant="primary" size="md">
              New interview
            </LinkButton>
          ) : undefined
        }
      />

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="search"
          placeholder="Search by title…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search interviews"
        />
        <select
          className={styles.filter}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {INTERVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </select>
        {isStaff && (
          <Button
            variant={mineOnly ? 'primary' : 'secondary'}
            size="md"
            onClick={() => {
              setMineOnly((v) => !v);
              setPage(1);
            }}
            aria-pressed={mineOnly}
          >
            Assigned to me
          </Button>
        )}
      </div>

      {error && (
        <Callout tone="danger" title="Could not load interviews">
          {error}
        </Callout>
      )}

      {loading && !data ? (
        <LoadingBlock label="Loading interviews" />
      ) : data && data.items.length > 0 ? (
        <Card>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Interview</th>
                  <th>Status</th>
                  <th>Scheduled</th>
                  <th>Questions</th>
                  <th>Runs</th>
                  <th>People</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((interview) => (
                  <tr key={interview.id}>
                    <td className={styles.titleCell}>
                      <Link to={`/interviews/${interview.id}`} className={styles.titleLink}>
                        {interview.title}
                      </Link>
                      <div className={styles.titleMeta}>
                        {titleCase(interview.language)} · {interview.durationMinutes} min
                        {interview.difficulty ? ` · ${titleCase(interview.difficulty)}` : ''}
                      </div>
                    </td>
                    <td>
                      <Badge tone={interviewStatusTone[interview.status] ?? 'neutral'} dot>
                        {titleCase(interview.status)}
                      </Badge>
                    </td>
                    <td className={styles.numeric}>
                      {interview.scheduledAt ? (
                        <span title={formatDateTime(interview.scheduledAt)}>
                          {formatRelative(interview.scheduledAt)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={styles.numeric}>{interview.questionCount}</td>
                    <td className={styles.numeric}>{interview.submissionCount}</td>
                    <td>
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
                    </td>
                    <td className={styles.actionsCell}>
                      {interview.status !== 'CANCELLED' && (
                        <LinkButton
                          to={`/interviews/${interview.id}/workspace`}
                          size="sm"
                          variant={interview.status === 'IN_PROGRESS' ? 'primary' : 'secondary'}
                        >
                          {interview.status === 'IN_PROGRESS' ? 'Join' : 'Open'}
                        </LinkButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.pagination}>
            <span>
              {data.total} {pluralise(data.total, 'interview')} · page {data.page} of {totalPages}
            </span>
            <div className={styles.pageButtons}>
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon="▤"
            title={
              debouncedSearch || status || mineOnly
                ? 'No interviews match those filters'
                : 'No interviews yet'
            }
            body={
              debouncedSearch || status || mineOnly
                ? 'Try clearing the search or the status filter.'
                : isStaff
                  ? 'Create an interview, attach questions from the library, then send the candidate an invitation link.'
                  : 'When an interviewer schedules a session with you it will appear here.'
            }
            actions={
              isStaff && !debouncedSearch && !status && !mineOnly ? (
                <LinkButton to="/interviews/new" variant="primary" size="sm">
                  New interview
                </LinkButton>
              ) : undefined
            }
          />
        </Card>
      )}
    </>
  );
}
