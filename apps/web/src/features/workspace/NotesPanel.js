import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { Avatar, Badge, EmptyState, Spinner } from '../../components/ui/Primitives';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Field';
import { api, ApiError } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { toast } from '../../store/toast';
import styles from './Workspace.module.css';
export function NotesPanel({ interviewId, activeQuestionId, isStaff, draft, onDraftChange, }) {
    const [notes, setNotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isPrivate, setIsPrivate] = useState(true);
    const [attachToQuestion, setAttachToQuestion] = useState(true);
    const load = useCallback(async () => {
        try {
            const data = await api.get(`/api/interviews/${interviewId}/notes`);
            setNotes(data.items);
        }
        catch {
            /* the panel degrades to empty rather than blocking the interview */
        }
        finally {
            setLoading(false);
        }
    }, [interviewId]);
    useEffect(() => {
        void load();
    }, [load]);
    const save = async () => {
        const body = draft.trim();
        if (!body)
            return;
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
        }
        catch (err) {
            toast.error('Could not save the note', err instanceof ApiError ? err.message : undefined);
        }
        finally {
            setSaving(false);
        }
    };
    return (_jsxs("div", { className: styles.panel, children: [_jsxs("div", { className: styles.panelHeader, children: [_jsx("span", { className: styles.panelTitle, children: "Notes" }), notes.length > 0 && _jsx(Badge, { tone: "neutral", children: notes.length })] }), isStaff && (_jsxs("div", { className: styles.noteComposer, children: [_jsx("textarea", { className: styles.noteBox, value: draft, onChange: (event) => onDraftChange(event.target.value), placeholder: "What the candidate said, what they tried, what you asked\u2026", onKeyDown: (event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                                event.preventDefault();
                                void save();
                            }
                        } }), _jsxs("div", { className: styles.noteComposerRow, children: [_jsx(Checkbox, { label: "Private", checked: isPrivate, onChange: (event) => setIsPrivate(event.target.checked) }), activeQuestionId && (_jsx(Checkbox, { label: "Attach to question", checked: attachToQuestion, onChange: (event) => setAttachToQuestion(event.target.checked) })), _jsx("div", { style: { flex: 1 } }), _jsx(Button, { size: "sm", variant: "primary", loading: saving, disabled: !draft.trim(), onClick: () => void save(), children: "Save note" })] }), _jsx("span", { className: styles.shortcutHint, children: "Private notes are never shown to the candidate. \u2318/Ctrl + Enter saves." })] })), _jsx("div", { className: styles.panelScroll, children: loading ? (_jsx("div", { style: { padding: 'var(--space-4)' }, children: _jsx(Spinner, { size: 16 }) })) : notes.length === 0 ? (_jsx(EmptyState, { icon: "\u270E", title: "No notes yet", body: isStaff
                        ? 'Write as you go — the evaluation page pulls these together afterwards.'
                        : 'Notes the interviewer chooses to share with you appear here.' })) : (notes.map((note) => (_jsxs("div", { className: styles.noteRow, children: [_jsxs("div", { className: styles.noteMeta, children: [_jsx(Avatar, { name: note.author.name, colorIndex: note.author.avatarColor, size: "sm" }), _jsx("span", { className: styles.noteAuthor, children: note.author.name }), _jsx("span", { children: formatRelative(note.createdAt) }), note.isPrivate && _jsx(Badge, { tone: "warning", children: "private" }), note.question && _jsx(Badge, { tone: "neutral", children: note.question.title })] }), _jsx("p", { className: styles.noteBody, children: note.body })] }, note.id)))) })] }));
}
