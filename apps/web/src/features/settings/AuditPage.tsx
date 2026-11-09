import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import {
  Badge,
  Callout,
  Card,
  EmptyState,
  LoadingBlock,
} from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, pluralise } from '../../lib/format';
import styles from './Settings.module.css';

interface AuditEventDto {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}

interface AuditResponse {
  total: number;
  page: number;
  pageSize: number;
  items: AuditEventDto[];
}

/** Colour the row by what kind of event it is, so denials stand out. */
function toneFor(action: string): 'danger' | 'warning' | 'success' | 'accent' | 'neutral' {
  if (action.startsWith('access.denied') || action.endsWith('login_failed')) return 'danger';
  if (action.startsWith('auth.')) return 'accent';
  if (action.includes('cancel') || action.includes('revoke') || action.includes('remove')) {
    return 'warning';
  }
  if (action.includes('create') || action.includes('submit') || action.includes('accept')) {
    return 'success';
  }
  return 'neutral';
}

export function AuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (actionFilter.trim()) params.set('action', actionFilter.trim());
    try {
      setData(await api.get<AuditResponse>(`/api/org/audit?${params.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of security- and data-relevant actions in this organization: sign-ins, permission denials, interview and question changes, code submissions, copilot requests and evaluations."
      />

      <div className={styles.toolbar}>
        <input
          className={styles.filterInput}
          placeholder="Exact action, e.g. access.denied"
          value={actionFilter}
          onChange={(event) => {
            setActionFilter(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by action"
        />
        <Button variant="secondary" size="md" onClick={() => void load()} loading={loading}>
          Refresh
        </Button>
      </div>

      {error && (
        <Callout tone="danger" title="Could not load the audit log">
          {error}
        </Callout>
      )}

      {loading && !data ? (
        <LoadingBlock label="Loading audit log" />
      ) : data && data.items.length > 0 ? (
        <Card>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>Detail</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((event) => (
                  <tr key={event.id}>
                    <td className={styles.muted}>{formatDateTime(event.createdAt)}</td>
                    <td>
                      <Badge tone={toneFor(event.action)}>{event.action}</Badge>
                    </td>
                    <td>
                      {event.actor ? (
                        <>
                          <div className={styles.userName}>{event.actor.name}</div>
                          <div className={styles.userEmail}>{event.actor.email}</div>
                        </>
                      ) : (
                        <span className={styles.muted}>system / anonymous</span>
                      )}
                    </td>
                    <td className={styles.mono}>
                      {event.targetType ? `${event.targetType}` : '—'}
                      {event.targetId && (
                        <div className={styles.muted} style={{ fontSize: 'var(--text-2xs)' }}>
                          {event.targetId}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className={styles.auditMeta}>
                        {Object.keys(event.metadata ?? {}).length > 0
                          ? JSON.stringify(event.metadata)
                          : '—'}
                      </div>
                    </td>
                    <td className={styles.mono}>{event.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.pagination}>
            <span>
              {data.total} {pluralise(data.total, 'event')} · page {data.page} of {totalPages}
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
            icon="⎙"
            title={actionFilter ? 'No events match that action' : 'No audit events yet'}
            body={
              actionFilter
                ? 'Action names are matched exactly — try "auth.login" or "interview.create".'
                : 'Events are written as people use the platform.'
            }
          />
        </Card>
      )}
    </>
  );
}
