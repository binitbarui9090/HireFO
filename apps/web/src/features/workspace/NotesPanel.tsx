import { useCallback, useEffect, useState } from 'react';
import { Avatar, Badge, EmptyState, Spinner } from '../../components/ui/Primitives';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Field';
import { api, ApiError } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { toast } from '../../store/toast';
import styles from './Workspace.module.css';

interface NoteDto {
  id: string;
  body: string;
  isPrivate: boolean;
  questionId: string | null;
  createdAt: string;
  author: { id: string; name: string; avatarColor: number };
  question?: { id: string; title: string } | null;
}

export interface NotesPanelProps {
  interviewId: string;
  activeQuestionId: string | null;
  isStaff: boolean;
  /** Controlled draft, so the copilot can push text into this box. */
  draft: string;
  onDraftChange: (value: string) => void;
}

export function NotesPanel({
  interviewId,
  activeQuestionId,
  isStaff,
  draft,
  onDraftChange,
}: NotesPanelProps) {
  const [notes, setNotes] = useState<NoteDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);
  const [attachToQuestion, setAttachToQuestion] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ items: NoteDto[] }>(`/api/interviews/${interviewId}/notes`);
      setNotes(data.items);
    } catch {
      /* the panel degrades to empty rather than blocking the interview */
    } finally {
      setLoading(false);
    }
  }, [interviewId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try {
      await api.post(`/api/interviews/${interviewId}/notes`, {
        body,
        isPrivate,
        ...(attachToQuestion && activeQuestionId ? { questionId: activeQuestionId } : {}),
      });
      onDraftChange('');
      await load();
      toast.success('Note saved');
    } catch (err) {
      toast.error('Could not save the note', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Notes</span>
        {notes.length > 0 && <Badge tone="neutral">{notes.length}</Badge>}
      </div>

      {isStaff && (
        <div className={styles.noteComposer}>
          <textarea
            className={styles.noteBox}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="What the candidate said, what they tried, what you asked…"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
            }}
          />
          <div className={styles.noteComposerRow}>
            <Checkbox
              label="Private"
              checked={isPrivate}
              onChange={(event) => setIsPrivate(event.target.checked)}
            />
            {activeQuestionId && (
              <Checkbox
                label="Attach to question"
                checked={attachToQuestion}
                onChange={(event) => setAttachToQuestion(event.target.checked)}
              />
            )}
            <div style={{ flex: 1 }} />
            <Button
              size="sm"
              variant="primary"
              loading={saving}
              disabled={!draft.trim()}
              onClick={() => void save()}
            >
              Save note
            </Button>
          </div>
          <span className={styles.shortcutHint}>
            Private notes are never shown to the candidate. ⌘/Ctrl + Enter saves.
          </span>
        </div>
      )}

      <div className={styles.panelScroll}>
        {loading ? (
          <div style={{ padding: 'var(--space-4)' }}>
            <Spinner size={16} />
          </div>
        ) : notes.length === 0 ? (
          <EmptyState
            icon="✎"
            title="No notes yet"
            body={
              isStaff
                ? 'Write as you go — the evaluation page pulls these together afterwards.'
                : 'Notes the interviewer chooses to share with you appear here.'
            }
          />
        ) : (
          notes.map((note) => (
            <div key={note.id} className={styles.noteRow}>
              <div className={styles.noteMeta}>
                <Avatar name={note.author.name} colorIndex={note.author.avatarColor} size="sm" />
                <span className={styles.noteAuthor}>{note.author.name}</span>
                <span>{formatRelative(note.createdAt)}</span>
                {note.isPrivate && <Badge tone="warning">private</Badge>}
                {note.question && <Badge tone="neutral">{note.question.title}</Badge>}
              </div>
              <p className={styles.noteBody}>{note.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
