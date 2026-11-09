import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { RECOMMENDATIONS } from '@hirefo/shared';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button, LinkButton } from '../../components/ui/Button';
import { Select, Textarea } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Avatar, Badge, Callout, Card, CardBody, CardHeader, difficultyTone, EmptyState, executionStatusTone, LoadingBlock, Stat, } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatMs, formatNumber, formatUsd, titleCase } from '../../lib/format';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import styles from './Evaluation.module.css';
export function EvaluationPage() {
    const { id = '' } = useParams();
    const currentUser = useAuthStore((s) => s.user);
    const [analytics, setAnalytics] = useState(null);
    const [rubrics, setRubrics] = useState([]);
    const [evaluations, setEvaluations] = useState([]);
    const [notes, setNotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [rubricId, setRubricId] = useState('');
    const [scores, setScores] = useState({});
    const [strengths, setStrengths] = useState('');
    const [concerns, setConcerns] = useState('');
    const [communication, setCommunication] = useState('');
    const [problemSolving, setProblemSolving] = useState('');
    const [summary, setSummary] = useState('');
    const [recommendation, setRecommendation] = useState('');
    const [saving, setSaving] = useState(false);
    const [confirmSubmit, setConfirmSubmit] = useState(false);
    const [error, setError] = useState(null);
    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const [analyticsData, rubricData, evaluationData, noteData] = await Promise.all([
                api.get(`/api/interviews/${id}/analytics`),
                api.get('/api/org/rubrics'),
                api.get(`/api/interviews/${id}/evaluations`),
                api.get(`/api/interviews/${id}/notes`),
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
        }
        catch (err) {
            setLoadError(err instanceof ApiError ? err.message : 'Could not load the evaluation.');
        }
        finally {
            setLoading(false);
        }
    }, [id, currentUser?.id]);
    useEffect(() => {
        void load();
    }, [load]);
    const own = evaluations.find((e) => e.authorId === currentUser?.id) ?? null;
    const locked = Boolean(own?.submittedAt);
    const activeRubric = rubrics.find((r) => r.id === rubricId) ?? null;
    const persist = async (submit) => {
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
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not save the evaluation.');
        }
        finally {
            setSaving(false);
        }
    };
    if (loading)
        return _jsx(LoadingBlock, { label: "Loading evaluation" });
    if (loadError || !analytics) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Evaluation", breadcrumbs: [{ label: 'Interviews', to: '/interviews' }] }), _jsx(Callout, { tone: "danger", title: "Could not load this evaluation", children: loadError ?? 'Not found.' })] }));
    }
    const { activity } = analytics;
    const passRate = activity.totalTestsRun > 0
        ? Math.round((activity.totalTestsPassed / activity.totalTestsRun) * 100)
        : null;
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Evaluation", description: analytics.interview.title, breadcrumbs: [
                    { label: 'Interviews', to: '/interviews' },
                    { label: analytics.interview.title, to: `/interviews/${id}` },
                    { label: 'Evaluation' },
                ], actions: _jsx(LinkButton, { to: `/interviews/${id}`, variant: "ghost", size: "md", children: "Interview details" }) }), _jsx(Callout, { tone: "info", title: "How to read this page", children: analytics.disclaimer }), _jsxs("div", { className: styles.statGrid, children: [_jsx(Stat, { label: "Questions completed", value: `${activity.questionsCompleted}/${activity.questionsAttached}`, hint: "all cases passed on a Submit run" }), _jsx(Stat, { label: "Test cases passed", value: passRate === null ? '—' : `${passRate}%`, hint: `${formatNumber(activity.totalTestsPassed)} of ${formatNumber(activity.totalTestsRun)} evaluated` }), _jsx(Stat, { label: "Code runs", value: formatNumber(activity.totalRuns), hint: `${activity.runsByKind.RUN} run · ${activity.runsByKind.SUBMIT} submit` }), _jsx(Stat, { label: "Session length", value: analytics.interview.elapsedMinutes !== null
                            ? `${analytics.interview.elapsedMinutes} min`
                            : '—', hint: `scheduled for ${analytics.interview.durationMinutes} min` }), _jsx(Stat, { label: "Median run time", value: formatMs(activity.medianExecutionMs), hint: "wall clock, per execution" }), _jsx(Stat, { label: "Interviewer notes", value: formatNumber(activity.noteCount), hint: `${activity.privateNoteCount} private` })] }), _jsxs("div", { className: styles.columns, children: [_jsxs("div", { className: styles.mainColumn, children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Your evaluation", subtitle: locked
                                            ? `Submitted ${formatDateTime(own?.submittedAt)} — read-only`
                                            : 'Saved as a draft until you submit it', actions: locked ? _jsx(Badge, { tone: "success", children: "submitted" }) : undefined }), _jsx(CardBody, { children: _jsxs("div", { className: styles.form, children: [error && (_jsx(Callout, { tone: "danger", title: "Could not save", children: error })), locked && (_jsx(Callout, { tone: "neutral", children: "A submitted evaluation cannot be edited. This is deliberate: the written assessment is the record of what you concluded at the time." })), rubrics.length > 1 && !locked && (_jsx(Select, { label: "Rubric", value: rubricId, onChange: (event) => {
                                                        setRubricId(event.target.value);
                                                        setScores({});
                                                    }, children: rubrics.map((rubric) => (_jsxs("option", { value: rubric.id, children: [rubric.name, rubric.isDefault ? ' (default)' : ''] }, rubric.id))) })), activeRubric ? (_jsxs("div", { children: [_jsx("div", { className: styles.sectionLabel, children: activeRubric.name }), activeRubric.description && (_jsx("p", { className: styles.sectionHint, children: activeRubric.description })), _jsx("div", { className: styles.rubricList, children: activeRubric.criteria.map((criterion) => {
                                                                const value = scores[criterion.key];
                                                                return (_jsxs("div", { className: styles.rubricRow, children: [_jsxs("div", { className: styles.rubricLabel, children: [_jsx("span", { className: styles.rubricName, children: criterion.label }), criterion.description && (_jsx("span", { className: styles.rubricDescription, children: criterion.description }))] }), _jsx("div", { className: styles.scoreGroup, role: "radiogroup", "aria-label": criterion.label, children: Array.from({ length: criterion.maxScore }, (_, i) => i + 1).map((score) => (_jsx("button", { type: "button", role: "radio", "aria-checked": value === score, disabled: locked, className: [
                                                                                    styles.scoreButton,
                                                                                    value === score ? styles.scoreButtonActive : '',
                                                                                ]
                                                                                    .filter(Boolean)
                                                                                    .join(' '), onClick: () => setScores((prev) => prev[criterion.key] === score
                                                                                    ? Object.fromEntries(Object.entries(prev).filter(([key]) => key !== criterion.key))
                                                                                    : { ...prev, [criterion.key]: score }), children: score }, score))) })] }, criterion.key));
                                                            }) })] })) : (_jsx(Callout, { tone: "warning", title: "No rubric configured", children: "An admin can add one under Team & invites. You can still write the narrative sections below." })), _jsx(Textarea, { label: "Problem-solving observations", value: problemSolving, onChange: (event) => setProblemSolving(event.target.value), disabled: locked, placeholder: "How they decomposed the problem, where they got stuck, how they recovered.", style: { minHeight: 100 } }), _jsx(Textarea, { label: "Communication observations", value: communication, onChange: (event) => setCommunication(event.target.value), disabled: locked, placeholder: "What they explained, how they responded to questions and hints.", hint: "Your observation, entered by you. Nothing here is inferred by the system.", style: { minHeight: 100 } }), _jsxs("div", { className: styles.twoUp, children: [_jsx(Textarea, { label: "Strengths", value: strengths, onChange: (event) => setStrengths(event.target.value), disabled: locked, style: { minHeight: 100 } }), _jsx(Textarea, { label: "Concerns", value: concerns, onChange: (event) => setConcerns(event.target.value), disabled: locked, style: { minHeight: 100 } })] }), _jsx(Textarea, { label: "Summary", value: summary, onChange: (event) => setSummary(event.target.value), disabled: locked, placeholder: "Your overall written assessment. This is the record.", style: { minHeight: 140 } }), _jsxs(Select, { label: "Recommendation", value: recommendation, onChange: (event) => setRecommendation(event.target.value), disabled: locked, hint: "Your judgement. The copilot never produces or influences this field.", children: [_jsx("option", { value: "", children: "Not stated" }), RECOMMENDATIONS.map((r) => (_jsx("option", { value: r, children: titleCase(r) }, r)))] }), !locked && (_jsxs("div", { className: styles.formActions, children: [_jsx(Button, { type: "button", variant: "secondary", loading: saving, onClick: () => void persist(false), children: "Save draft" }), _jsx(Button, { type: "button", variant: "primary", disabled: saving || !summary.trim(), onClick: () => setConfirmSubmit(true), title: !summary.trim() ? 'Write a summary before submitting' : undefined, children: "Submit evaluation" })] }))] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Per-question activity", subtitle: "Counts, not scores" }), analytics.perQuestion.length > 0 ? (_jsx("div", { children: analytics.perQuestion.map((question) => (_jsxs("div", { className: styles.questionRow, children: [_jsxs("div", { className: styles.questionMain, children: [_jsx("div", { className: styles.questionTitle, children: question.title }), _jsxs("div", { className: styles.questionMeta, children: [_jsx(Badge, { tone: difficultyTone[question.difficulty] ?? 'neutral', children: titleCase(question.difficulty) }), _jsxs("span", { children: [question.runCount, " run", question.runCount === 1 ? '' : 's'] }), _jsx("span", { children: "\u00B7" }), _jsxs("span", { children: [question.submitCount, " submit", question.submitCount === 1 ? '' : 's'] })] })] }), _jsxs("div", { className: styles.questionScore, children: [_jsx("span", { className: styles.questionScoreValue, children: question.bestTotal > 0
                                                                ? `${question.bestPassed}/${question.bestTotal}`
                                                                : '—' }), _jsx("span", { className: styles.questionScoreLabel, children: "best run" })] }), _jsx(Badge, { tone: question.completed ? 'success' : 'neutral', dot: true, children: question.completed ? 'all passed' : 'incomplete' })] }, question.questionId))) })) : (_jsx(EmptyState, { icon: "\u2751", title: "No questions were attached" }))] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Interviewer notes", subtitle: `${notes.length} recorded during the session` }), notes.length > 0 ? (_jsx("div", { children: notes.map((note) => (_jsxs("div", { className: styles.noteRow, children: [_jsxs("div", { className: styles.noteMeta, children: [_jsx(Avatar, { name: note.author.name, colorIndex: note.author.avatarColor, size: "sm" }), _jsx("span", { className: styles.noteAuthor, children: note.author.name }), _jsx("span", { children: formatDateTime(note.createdAt) }), note.isPrivate && _jsx(Badge, { tone: "warning", children: "private" }), note.question && _jsx(Badge, { tone: "neutral", children: note.question.title })] }), _jsx("p", { className: styles.noteBody, children: note.body })] }, note.id))) })) : (_jsx(EmptyState, { icon: "\u270E", title: "No notes were taken", body: "Notes are written from the workspace panel during the interview." }))] })] }), _jsxs("div", { className: styles.sideColumn, children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Session" }), _jsxs("div", { className: styles.metaList, children: [_jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Status" }), _jsx("span", { className: styles.metaValue, children: titleCase(analytics.interview.status) })] }), _jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Language" }), _jsx("span", { className: styles.metaValue, children: titleCase(analytics.interview.language) })] }), _jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Started" }), _jsx("span", { className: styles.metaValue, children: formatDateTime(analytics.interview.startedAt) })] }), _jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Ended" }), _jsx("span", { className: styles.metaValue, children: formatDateTime(analytics.interview.endedAt) })] }), analytics.activity.aiSuggestionCount > 0 && (_jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Copilot" }), _jsxs("span", { className: styles.metaValue, children: [analytics.activity.aiSuggestionCount, " requests \u00B7", ' ', formatUsd(analytics.activity.aiCostUsd)] })] }))] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Execution outcomes", subtitle: "Status of every queued job" }), _jsx("div", { className: styles.metaList, children: Object.entries(activity.executionStatusCounts).length > 0 ? (Object.entries(activity.executionStatusCounts).map(([status, count]) => (_jsxs("div", { className: styles.metaRow, children: [_jsx(Badge, { tone: executionStatusTone[status] ?? 'neutral', dot: true, children: titleCase(status) }), _jsx("span", { className: styles.metaValue, children: count })] }, status)))) : (_jsx("span", { className: styles.sectionHint, children: "No code was executed." })) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Participants" }), _jsx("div", { children: analytics.participants.map((participant) => (_jsxs("div", { className: styles.participantRow, children: [_jsxs("div", { className: styles.participantMain, children: [_jsx("div", { className: styles.participantName, children: participant.name }), _jsx("div", { className: styles.participantEmail, children: participant.email })] }), _jsx(Badge, { tone: participant.role === 'CANDIDATE' ? 'accent' : 'neutral', children: titleCase(participant.role) })] }, participant.userId))) })] }), analytics.evaluations.length > 0 && (_jsxs(Card, { children: [_jsx(CardHeader, { title: "All evaluations", subtitle: "One per interviewer" }), _jsx("div", { children: analytics.evaluations.map((evaluation) => (_jsxs("div", { className: styles.participantRow, children: [_jsxs("div", { className: styles.participantMain, children: [_jsx("div", { className: styles.participantName, children: evaluation.author.name }), _jsx("div", { className: styles.participantEmail, children: evaluation.submittedAt
                                                                ? `submitted ${formatDateTime(evaluation.submittedAt)}`
                                                                : 'draft' })] }), evaluation.recommendation ? (_jsx(Badge, { tone: evaluation.recommendation.includes('YES')
                                                        ? 'success'
                                                        : evaluation.recommendation.includes('NO')
                                                            ? 'danger'
                                                            : 'neutral', children: titleCase(evaluation.recommendation) })) : (_jsx(Badge, { tone: "neutral", children: "no recommendation" }))] }, evaluation.id))) })] }))] })] }), _jsx(Modal, { open: confirmSubmit, onClose: () => setConfirmSubmit(false), title: "Submit this evaluation?", description: "Once submitted it becomes read-only. You will not be able to change the scores, the narrative or the recommendation.", size: "sm", dismissOnBackdrop: false, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: () => setConfirmSubmit(false), children: "Keep editing" }), _jsx(Button, { variant: "primary", loading: saving, onClick: () => void persist(true), children: "Submit" })] }), children: _jsx("p", { style: { fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }, children: recommendation
                        ? `Your recommendation is "${titleCase(recommendation)}".`
                        : 'You have not stated a recommendation. That is allowed — the written summary is the record.' }) })] }));
}
