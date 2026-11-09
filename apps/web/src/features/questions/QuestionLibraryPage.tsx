import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DIFFICULTIES } from '@hirefo/shared';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button, LinkButton } from '../../components/ui/Button';
import {
  Badge,
  Callout,
  Card,
  difficultyTone,
  EmptyState,
  LoadingBlock,
} from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatRelative, pluralise, titleCase } from '../../lib/format';
import { useCapabilitiesStore } from '../../store/capabilities';
import styles from './Questions.module.css';
import type { Paged, QuestionSummaryDto } from '../interviews/types';

export function QuestionLibraryPage() {
  const capabilities = useCapabilitiesStore((s) => s.data);

  const [data, setData] = useState<Paged<QuestionSummaryDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [category, setCategory] = useState('');
  const [language, setLanguage] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
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
    const params = new URLSearchParams({ page: String(page), pageSize: '24' });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (difficulty) params.set('difficulty', difficulty);
    if (category) params.set('category', category);
    if (language) params.set('language', language);
    if (includeArchived) params.set('includeArchived', 'true');

    try {
      setData(await api.get<Paged<QuestionSummaryDto>>(`/api/questions?${params.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the question library.');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, difficulty, category, language, includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(debouncedSearch || difficulty || category || language);

  return (
    <>
      <PageHeader
        title="Question library"
        description="Questions, their example cases and their hidden test cases. Only interviewers and admins can see this page."
        actions={
          <LinkButton to="/questions/new" variant="primary" size="md">
            New question
          </LinkButton>
        }
      />

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="search"
          placeholder="Search titles and statements…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search questions"
        />
        <select
          className={styles.filter}
          value={difficulty}
          onChange={(event) => {
            setDifficulty(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by difficulty"
        >
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {titleCase(d)}
            </option>
          ))}
        </select>
        <select
          className={styles.filter}
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by category"
        >
          <option value="">Any category</option>
          {capabilities?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className={styles.filter}
          value={language}
          onChange={(event) => {
            setLanguage(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by language"
        >
          <option value="">Any language</option>
          {capabilities?.languages.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <Button
          variant={includeArchived ? 'primary' : 'secondary'}
          size="md"
          onClick={() => {
            setIncludeArchived((v) => !v);
            setPage(1);
          }}
          aria-pressed={includeArchived}
        >
          Show archived
        </Button>
      </div>

      {error && (
        <Callout tone="danger" title="Could not load questions">
          {error}
        </Callout>
      )}

      {loading && !data ? (
        <LoadingBlock label="Loading questions" />
      ) : data && data.items.length > 0 ? (
        <>
          <div className={styles.grid}>
            {data.items.map((question) => (
              <Link
                key={question.id}
                to={`/questions/${question.id}`}
                className={[styles.card, question.isArchived ? styles.cardArchived : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <div>
                  <div className={styles.cardTitle}>{question.title}</div>
                </div>
                <div className={styles.cardBadges}>
                  <Badge tone={difficultyTone[question.difficulty] ?? 'neutral'}>
                    {titleCase(question.difficulty)}
                  </Badge>
                  {question.isArchived && <Badge tone="warning">archived</Badge>}
                  {question.testCaseCount === 0 && <Badge tone="danger">no tests</Badge>}
                  {question.expectedComplexity && (
                    <Badge tone="info">{question.expectedComplexity}</Badge>
                  )}
                </div>
                <div className={styles.cardBadges}>
                  {question.categories.slice(0, 3).map((c) => (
                    <Badge key={c} tone="neutral">
                      {titleCase(c)}
                    </Badge>
                  ))}
                </div>
                <div className={styles.cardFooter}>
                  <span>
                    {question.testCaseCount} {pluralise(question.testCaseCount, 'test')}
                  </span>
                  <span>·</span>
                  <span>
                    used in {question.usedInInterviews}{' '}
                    {pluralise(question.usedInInterviews, 'interview')}
                  </span>
                  <span>·</span>
                  <span>edited {formatRelative(question.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
              marginTop: 'var(--space-5)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-tertiary)',
            }}
          >
            <span>
              {data.total} {pluralise(data.total, 'question')} · page {data.page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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
        </>
      ) : (
        <Card>
          <EmptyState
            icon="❑"
            title={filtered ? 'No questions match those filters' : 'The library is empty'}
            body={
              filtered
                ? 'Try clearing the search or the filters.'
                : 'Add a question with a statement, examples and hidden test cases. Interviews draw their question sets from here.'
            }
            actions={
              !filtered ? (
                <LinkButton to="/questions/new" variant="primary" size="sm">
                  Create the first question
                </LinkButton>
              ) : undefined
            }
          />
        </Card>
      )}
    </>
  );
}
