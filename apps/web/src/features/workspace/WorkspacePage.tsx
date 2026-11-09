import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CursorState, DocSnapshot, LanguageId, PresenceUser } from '@hirefo/shared';
import { Button } from '../../components/ui/Button';
import {
  Avatar,
  Badge,
  Callout,
  interviewStatusTone,
  Kbd,
  LoadingBlock,
} from '../../components/ui/Primitives';
import { SplitPane } from '../../components/ui/SplitPane';
import { Tabs } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDuration, titleCase } from '../../lib/format';
import { emitWithAck, getSocket } from '../../lib/socket';
import { useAuthStore } from '../../store/auth';
import { useCapabilitiesStore } from '../../store/capabilities';
import { toast } from '../../store/toast';
import type {
  ExecutionDetailDto,
  ExecutionHistoryItem,
  InterviewDetailDto,
} from '../interviews/types';
import { CopilotPanel } from './CopilotPanel';
import { EditorPanel, monacoLanguageFor } from './EditorPanel';
import { NotesPanel } from './NotesPanel';
import { OutputPanel } from './OutputPanel';
import { QuestionPanel } from './QuestionPanel';
import { useCollaborativeDoc } from './useCollaborativeDoc';
import styles from './Workspace.module.css';

type SidePanel = 'copilot' | 'notes';

/** How long a terminal execution status can take before we stop waiting on it. */
const EXECUTION_POLL_INTERVAL_MS = 1_500;
const EXECUTION_POLL_TIMEOUT_MS = 120_000;

export function WorkspacePage() {
  const { id = '' } = useParams<{ id: string }>();
  const currentUser = useAuthStore((s) => s.user);
  const capabilities = useCapabilitiesStore((s) => s.data);

  const [interview, setInterview] = useState<InterviewDetailDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<DocSnapshot | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [connected, setConnected] = useState(false);
  const [remoteCursors, setRemoteCursors] = useState<
    Map<string, { cursor: CursorState; name: string; colorIndex: number }>
  >(new Map());

  const [execution, setExecution] = useState<ExecutionDetailDto | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    passedCount?: number;
    totalCount?: number;
    status: string;
  } | null>(null);
  const [history, setHistory] = useState<ExecutionHistoryItem[]>([]);
  const [customStdin, setCustomStdin] = useState('');

  const [sidePanel, setSidePanel] = useState<SidePanel>('copilot');
  const [noteDraft, setNoteDraft] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);

  const doc = useCollaborativeDoc(initialSnapshot);
  const docContentRef = useRef(doc.content);
  docContentRef.current = doc.content;

  /* ------------------------------ load ------------------------------ */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await api.get<InterviewDetailDto>(`/api/interviews/${id}`);
        if (cancelled) return;
        setInterview(detail);
        setActiveQuestionId(detail.activeQuestionId ?? detail.questions[0]?.questionId ?? null);

        await api.post(`/api/interviews/${id}/join`).catch(() => undefined);

        const snapshot = await api.post<DocSnapshot>(`/api/interviews/${id}/documents`, {
          questionId: detail.activeQuestionId ?? detail.questions[0]?.questionId ?? null,
        });
        if (!cancelled) setInitialSnapshot(snapshot);

        const historyData = await api.get<{ items: ExecutionHistoryItem[] }>(
          `/api/interviews/${id}/executions`,
        );
        if (!cancelled) setHistory(historyData.items);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : 'Could not open this interview.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /* ------------------------------ socket ------------------------------ */

  useEffect(() => {
    if (!interview) return;
    const socket = getSocket();

    const join = async () => {
      const result = await emitWithAck<{
        role: string;
        users: PresenceUser[];
        activeQuestionId: string | null;
      }>('interview:join', { interviewId: id });
      if (result.ok) {
        setPresence(result.data.users);
        setConnected(true);
        if (result.data.activeQuestionId) setActiveQuestionId(result.data.activeQuestionId);
      } else {
        toast.error('Could not join the live session', result.error);
      }
    };

    const onPresence = (payload: { interviewId: string; users: PresenceUser[] }) => {
      if (payload.interviewId === id) setPresence(payload.users);
    };

    const onCursor = (payload: { documentId: string; cursor: CursorState }) => {
      if (payload.cursor.userId === currentUser?.id) return;
      setRemoteCursors((prev) => {
        const next = new Map(prev);
        const user = presence.find((p) => p.userId === payload.cursor.userId);
        next.set(payload.cursor.userId, {
          cursor: payload.cursor,
          name: user?.name ?? 'Collaborator',
          colorIndex: user?.colorIndex ?? 1,
        });
        return next;
      });
    };

    const onSnapshotEvent = (snapshot: DocSnapshot) => {
      // The interviewer switched question: adopt the new document wholesale.
      if (snapshot.documentId !== doc.documentId) {
        setActiveQuestionId(snapshot.questionId);
        setInitialSnapshot(snapshot);
      }
    };

    const onExecutionUpdate = (payload: {
      jobId: string;
      submissionId: string;
      status: string;
      passedCount?: number;
      totalCount?: number;
      message?: string;
    }) => {
      setProgress({
        status: payload.status,
        ...(payload.passedCount !== undefined ? { passedCount: payload.passedCount } : {}),
        ...(payload.totalCount !== undefined ? { totalCount: payload.totalCount } : {}),
      });
      if (['SUCCEEDED', 'FAILED', 'TIMEOUT', 'ERROR', 'CANCELLED'].includes(payload.status)) {
        void loadExecution(payload.jobId);
      }
    };

    const onConnect = () => void join();
    const onDisconnect = () => setConnected(false);

    socket.on('presence:state', onPresence);
    socket.on('cursor:update', onCursor);
    socket.on('doc:snapshot', onSnapshotEvent);
    socket.on('execution:update', onExecutionUpdate);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    if (socket.connected) void join();
    else socket.connect();

    return () => {
      socket.off('presence:state', onPresence);
      socket.off('cursor:update', onCursor);
      socket.off('doc:snapshot', onSnapshotEvent);
      socket.off('execution:update', onExecutionUpdate);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.emit('interview:leave', { interviewId: id });
    };
    // `presence` is read inside onCursor only to decorate the name; re-subscribing
    // on every presence change would churn listeners, so it is deliberately out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview, id, currentUser?.id, doc.documentId]);

  /* ------------------------------ timer ------------------------------ */

  useEffect(() => {
    if (!interview?.startedAt) return;
    const started = new Date(interview.startedAt).getTime();
    const end = interview.endedAt ? new Date(interview.endedAt).getTime() : null;
    if (end) {
      setElapsedMs(end - started);
      return;
    }
    const tick = () => setElapsedMs(Date.now() - started);
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [interview?.startedAt, interview?.endedAt]);

  /* ------------------------------ execution ------------------------------ */

  const loadExecution = useCallback(
    async (executionId: string) => {
      try {
        const detail = await api.get<ExecutionDetailDto>(
          `/api/interviews/${id}/executions/${executionId}`,
        );
        setExecution(detail);
        if (['SUCCEEDED', 'FAILED', 'TIMEOUT', 'ERROR', 'CANCELLED'].includes(detail.status)) {
          setRunning(false);
          setProgress(null);
          const historyData = await api
            .get<{ items: ExecutionHistoryItem[] }>(`/api/interviews/${id}/executions`)
            .catch(() => null);
          if (historyData) setHistory(historyData.items);
        }
        return detail;
      } catch {
        return null;
      }
    },
    [id],
  );

  /**
   * Socket events are the fast path, but a dropped connection must not leave the
   * UI spinning forever — so the result is also polled until it reaches a
   * terminal status.
   */
  const pollUntilDone = useCallback(
    async (executionId: string) => {
      const deadline = Date.now() + EXECUTION_POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, EXECUTION_POLL_INTERVAL_MS));
        const detail = await loadExecution(executionId);
        if (
          detail &&
          ['SUCCEEDED', 'FAILED', 'TIMEOUT', 'ERROR', 'CANCELLED'].includes(detail.status)
        ) {
          return;
        }
      }
      setRunning(false);
      toast.warning(
        'Still waiting on the execution worker',
        'The job has not reported a result. Check that the worker process is running.',
      );
    },
    [loadExecution],
  );

  const activeQuestion = useMemo(
    () => interview?.questions.find((q) => q.questionId === activeQuestionId) ?? null,
    [interview, activeQuestionId],
  );

  const languageSpec = capabilities?.languages.find((l) => l.id === doc.language);
  const canExecute = languageSpec?.executable ?? false;
  const isTerminalStatus =
    interview && ['COMPLETED', 'CANCELLED'].includes(interview.status);

  const run = useCallback(
    async (kind: 'RUN' | 'SUBMIT') => {
      if (!interview || running) return;
      if (!canExecute) {
        toast.warning('This language cannot be executed', languageSpec?.executionNote);
        return;
      }
      if (isTerminalStatus) {
        toast.warning(`Interview is ${interview.status.toLowerCase()}`, 'Code can no longer be run.');
        return;
      }

      setRunning(true);
      setProgress({ status: 'QUEUED' });
      setExecution(null);

      try {
        const response = await api.post<{ submissionId: string; executionJobId: string }>(
          `/api/interviews/${id}/submissions`,
          {
            ...(activeQuestionId ? { questionId: activeQuestionId } : {}),
            language: doc.language,
            code: docContentRef.current,
            kind,
            ...(customStdin ? { customStdin } : {}),
          },
        );
        void pollUntilDone(response.executionJobId);
      } catch (err) {
        setRunning(false);
        setProgress(null);
        toast.error(
          'Could not queue the run',
          err instanceof ApiError ? err.message : 'The execution queue did not accept the job.',
        );
      }
    },
    [
      interview,
      running,
      canExecute,
      languageSpec,
      isTerminalStatus,
      id,
      activeQuestionId,
      doc.language,
      customStdin,
      pollUntilDone,
    ],
  );

  /* ------------------------------ interactions ------------------------------ */

  const switchQuestion = async (questionId: string) => {
    if (!interview?.isStaff) return;
    setSwitching(true);
    const result = await emitWithAck<DocSnapshot>('doc:switch-question', {
      interviewId: id,
      questionId,
    });
    setSwitching(false);
    if (result.ok) {
      setActiveQuestionId(questionId);
      setInitialSnapshot(result.data);
      setExecution(null);
    } else {
      toast.error('Could not switch question', result.error);
    }
  };

  const changeLanguage = async (next: LanguageId) => {
    const ok = await doc.setLanguage(next);
    if (!ok) toast.error('Could not change the language');
  };

  const sendCursor = useCallback(
    (cursor: Omit<CursorState, 'userId'>) => {
      if (!doc.documentId) return;
      getSocket().emit('cursor:update', { documentId: doc.documentId, cursor });
    },
    [doc.documentId],
  );

  /* ------------------------------ render ------------------------------ */

  if (loadError) {
    return (
      <div className={styles.workspace}>
        <div className={styles.centered}>
          <div style={{ maxWidth: 480 }}>
            <Callout tone="danger" title="Could not open this interview">
              {loadError}
            </Callout>
            <p style={{ marginTop: 'var(--space-4)' }}>
              <Link to="/interviews">← Back to interviews</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!interview || !doc.documentId) {
    return (
      <div className={styles.workspace}>
        <LoadingBlock label="Opening workspace" />
      </div>
    );
  }

  const durationMs = interview.durationMinutes * 60_000;
  const overTime = interview.startedAt !== null && elapsedMs > durationMs;
  const syncLabel: Record<string, string> = {
    connecting: 'connecting',
    live: `v${doc.version}`,
    syncing: 'resyncing…',
    offline: 'offline',
  };

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <Link to={`/interviews/${id}`} className={styles.back}>
          ← Details
        </Link>

        <div className={styles.headerTitle}>
          <div className={styles.title}>{interview.title}</div>
          <div className={styles.subtitle}>
            {languageSpec?.label ?? titleCase(doc.language ?? '')} ·{' '}
            {activeQuestion ? activeQuestion.title : 'scratch buffer'}
          </div>
        </div>

        <div className={styles.headerActions}>
          <div className={styles.presence}>
            <div className={styles.presenceAvatars}>
              {presence.map((user) => (
                <Avatar
                  key={user.userId}
                  name={user.name}
                  colorIndex={user.colorIndex}
                  size="sm"
                  ring
                  title={`${user.name} — ${user.role.toLowerCase()}${
                    user.socketCount > 1 ? ` (${user.socketCount} tabs)` : ''
                  }`}
                />
              ))}
            </div>
            <span className={styles.connection}>
              <span
                className={[
                  styles.connectionDot,
                  connected && doc.syncState === 'live'
                    ? styles.dotLive
                    : doc.syncState === 'offline'
                      ? styles.dotDead
                      : styles.dotStale,
                ].join(' ')}
                aria-hidden="true"
              />
              {presence.length} online
            </span>
          </div>

          <div className={[styles.timer, overTime ? styles.timerOver : ''].filter(Boolean).join(' ')}>
            <span className={styles.timerLabel}>
              {interview.startedAt ? (overTime ? 'over' : 'elapsed') : 'not started'}
            </span>
            {interview.startedAt ? formatDuration(elapsedMs) : `${interview.durationMinutes}:00`}
          </div>

          <Badge tone={interviewStatusTone[interview.status] ?? 'neutral'} dot>
            {titleCase(interview.status)}
          </Badge>
        </div>
      </header>

      <div className={styles.mobileWarning}>
        <Callout tone="warning" title="The workspace needs a wider screen">
          The collaborative editor, console and copilot need at least 860px of width. Open this
          interview on a laptop or desktop.
        </Callout>
      </div>

      <div className={styles.body}>
        <SplitPane
          direction="horizontal"
          initial={26}
          min={16}
          max={42}
          storageKey="workspace-question"
          ariaLabel="Resize the question panel"
          first={
            <QuestionPanel
              questions={interview.questions}
              activeQuestionId={activeQuestionId}
              canSwitch={interview.isStaff}
              isStaff={interview.isStaff}
              onSwitch={(questionId) => void switchQuestion(questionId)}
              switching={switching}
            />
          }
          second={
            <SplitPane
              direction="horizontal"
              initial={interview.isStaff ? 62 : 100}
              min={40}
              max={interview.isStaff ? 80 : 100}
              storageKey="workspace-editor"
              ariaLabel="Resize the editor area"
              first={
                <SplitPane
                  direction="vertical"
                  initial={62}
                  min={25}
                  max={85}
                  storageKey="workspace-output"
                  ariaLabel="Resize the output panel"
                  first={
                    <div className={styles.panel}>
                      <div className={styles.editorToolbar}>
                        <label className="srOnly" htmlFor="workspace-language">
                          Editor language
                        </label>
                        <select
                          id="workspace-language"
                          className={styles.langSelect}
                          value={doc.language ?? ''}
                          disabled={!interview.isStaff}
                          onChange={(event) => void changeLanguage(event.target.value as LanguageId)}
                          title={
                            interview.isStaff
                              ? 'Change the language for everyone'
                              : 'Only the interviewer can change the language'
                          }
                        >
                          {capabilities?.languages.map((language) => (
                            <option key={language.id} value={language.id}>
                              {language.label}
                            </option>
                          ))}
                        </select>

                        <span className={styles.shortcutHint}>
                          <Kbd>⌘/Ctrl</Kbd>
                          <Kbd>↵</Kbd> run
                        </span>
                        <span className={styles.shortcutHint}>
                          <Kbd>⌘/Ctrl</Kbd>
                          <Kbd>⇧</Kbd>
                          <Kbd>↵</Kbd> submit
                        </span>

                        <span className={styles.toolbarSpacer} />

                        <span
                          className={[
                            styles.syncState,
                            doc.syncState !== 'live' ? styles.syncStale : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {syncLabel[doc.syncState]}
                        </span>
                        {doc.syncState === 'offline' && (
                          <Button size="sm" variant="ghost" onClick={() => void doc.resync()}>
                            Retry
                          </Button>
                        )}
                      </div>

                      <EditorPanel
                        doc={doc}
                        monacoLanguage={monacoLanguageFor(doc.language)}
                        readOnly={Boolean(isTerminalStatus)}
                        remoteCursors={remoteCursors}
                        onCursorMove={sendCursor}
                        onRun={() => void run('RUN')}
                        onSubmit={() => void run('SUBMIT')}
                      />

                      <div className={styles.runBar}>
                        <span className={styles.runSummary}>
                          {isTerminalStatus
                            ? `This interview is ${interview.status.toLowerCase()} — the editor is read-only.`
                            : canExecute
                              ? capabilities?.execution.isolated
                                ? `Runs in an isolated container · ${capabilities.execution.limits.memoryMb}MB · ${capabilities.execution.limits.cpus} CPU · no network`
                                : 'DEV RUNNER: runs as a child process on the API host, not in a container.'
                              : (languageSpec?.executionNote ?? 'This language cannot be executed.')}
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void run('RUN')}
                          loading={running}
                          disabled={!canExecute || Boolean(isTerminalStatus)}
                          title="Run against the visible example cases"
                        >
                          Run
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => void run('SUBMIT')}
                          disabled={running || !canExecute || Boolean(isTerminalStatus)}
                          title="Run against every case, including the hidden ones"
                        >
                          Submit
                        </Button>
                      </div>
                    </div>
                  }
                  second={
                    <OutputPanel
                      execution={execution}
                      running={running}
                      progress={progress}
                      history={history}
                      customStdin={customStdin}
                      onCustomStdinChange={setCustomStdin}
                      onSelectHistory={(executionId) => void loadExecution(executionId)}
                      hasTestCases={(activeQuestion?.testCaseCount ?? 0) > 0}
                      isStaff={interview.isStaff}
                    />
                  }
                />
              }
              second={
                interview.isStaff ? (
                  <div className={[styles.panel, styles.sideBorder].join(' ')}>
                    <div style={{ padding: '0 var(--space-2)' }}>
                      <Tabs
                        items={[
                          { id: 'copilot', label: 'Copilot' },
                          { id: 'notes', label: 'Notes' },
                        ]}
                        value={sidePanel}
                        onChange={(value) => setSidePanel(value)}
                        ariaLabel="Interviewer tools"
                      />
                    </div>
                    {sidePanel === 'copilot' ? (
                      <CopilotPanel
                        interviewId={id}
                        activeQuestionId={activeQuestionId}
                        code={doc.content}
                        latestExecutionJobId={execution?.id ?? null}
                        onUseAsNote={(text) => {
                          setNoteDraft(text);
                          setSidePanel('notes');
                        }}
                      />
                    ) : (
                      <NotesPanel
                        interviewId={id}
                        activeQuestionId={activeQuestionId}
                        isStaff={interview.isStaff}
                        draft={noteDraft}
                        onDraftChange={setNoteDraft}
                      />
                    )}
                  </div>
                ) : (
                  <div />
                )
              }
            />
          }
        />
      </div>
    </div>
  );
}
