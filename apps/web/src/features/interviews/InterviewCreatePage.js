import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DIFFICULTIES } from '@hirefo/shared';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button, LinkButton } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Field';
import { Badge, Callout, Card, CardBody, CardHeader, difficultyTone, EmptyState, LoadingBlock, } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { titleCase } from '../../lib/format';
import { useCapabilitiesStore } from '../../store/capabilities';
import { toast } from '../../store/toast';
import styles from './Interviews.module.css';
export function InterviewCreatePage() {
    const navigate = useNavigate();
    const capabilities = useCapabilitiesStore((s) => s.data);
    const [questions, setQuestions] = useState(null);
    const [members, setMembers] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [title, setTitle] = useState('');
    const [language, setLanguage] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [scheduledAt, setScheduledAt] = useState('');
    const [durationMinutes, setDurationMinutes] = useState(60);
    const [selectedQuestionIds, setSelectedQuestionIds] = useState([]);
    const [interviewerIds, setInterviewerIds] = useState([]);
    const [candidateUserId, setCandidateUserId] = useState('');
    const [candidateEmail, setCandidateEmail] = useState('');
    const [privateNotes, setPrivateNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [fieldErrors, setFieldErrors] = useState({});
    useEffect(() => {
        (async () => {
            try {
                const [questionData, memberData] = await Promise.all([
                    api.get('/api/questions?pageSize=100'),
                    api.get('/api/org/members'),
                ]);
                setQuestions(questionData.items);
                setMembers(memberData.items);
            }
            catch (err) {
                setLoadError(err instanceof ApiError ? err.message : 'Could not load the question library or team.');
            }
        })();
    }, []);
    // Default the language to the first executable one the backend reports.
    useEffect(() => {
        if (!language && capabilities?.languages.length) {
            setLanguage(capabilities.languages.find((l) => l.executable)?.id ?? capabilities.languages[0].id);
        }
    }, [capabilities, language]);
    const availableQuestions = useMemo(() => (questions ?? []).filter((q) => !language || q.languages.includes(language)), [questions, language]);
    const staff = useMemo(() => (members ?? []).filter((m) => m.role !== 'CANDIDATE' && m.status === 'ACTIVE'), [members]);
    const candidates = useMemo(() => (members ?? []).filter((m) => m.role === 'CANDIDATE' && m.status === 'ACTIVE'), [members]);
    const toggleQuestion = (id) => setSelectedQuestionIds((prev) => prev.includes(id) ? prev.filter((q) => q !== id) : [...prev, id]);
    const toggleInterviewer = (id) => setInterviewerIds((prev) => (prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]));
    const onSubmit = async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        setFieldErrors({});
        try {
            const created = await api.post('/api/interviews', {
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
        }
        catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
                setFieldErrors(err.fieldErrors ?? {});
            }
            else {
                setError('Could not create the interview.');
            }
        }
        finally {
            setSubmitting(false);
        }
    };
    const serverError = (field) => fieldErrors[field]?.[0] ?? null;
    if (loadError) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "New interview", breadcrumbs: [{ label: 'Interviews', to: '/interviews' }] }), _jsx(Callout, { tone: "danger", title: "Could not load required data", children: loadError })] }));
    }
    if (!questions || !members)
        return _jsx(LoadingBlock, { label: "Loading question library" });
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "New interview", description: "Pick the language and the questions now; you can still change them before the session starts.", breadcrumbs: [{ label: 'Interviews', to: '/interviews' }, { label: 'New' }] }), _jsx("form", { onSubmit: onSubmit, noValidate: true, children: _jsxs("div", { className: styles.formGrid, children: [error && (_jsx(Callout, { tone: "danger", title: "Could not create the interview", children: error })), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Basics" }), _jsx(CardBody, { children: _jsxs("div", { className: styles.formGrid, children: [_jsx(Input, { label: "Title", required: true, value: title, onChange: (event) => setTitle(event.target.value), placeholder: "Senior Frontend \u2014 technical round", error: serverError('title') }), _jsxs("div", { className: styles.formRow, children: [_jsx(Select, { label: "Language", required: true, value: language, onChange: (event) => {
                                                            setLanguage(event.target.value);
                                                            setSelectedQuestionIds([]);
                                                        }, error: serverError('language'), hint: capabilities?.languages.find((l) => l.id === language)?.executionNote ?? undefined, children: capabilities?.languages.map((l) => (_jsxs("option", { value: l.id, children: [l.label, l.executable ? '' : ' — not executable'] }, l.id))) }), _jsxs(Select, { label: "Difficulty", optional: true, value: difficulty, onChange: (event) => setDifficulty(event.target.value), hint: "A label for your own filtering; it does not change the questions.", children: [_jsx("option", { value: "", children: "Not set" }), DIFFICULTIES.map((d) => (_jsx("option", { value: d, children: titleCase(d) }, d)))] })] }), _jsxs("div", { className: styles.formRow, children: [_jsx(Input, { label: "Scheduled start", type: "datetime-local", optional: true, value: scheduledAt, onChange: (event) => setScheduledAt(event.target.value), hint: "Leave blank to keep the interview as a draft." }), _jsx(Input, { label: "Duration (minutes)", type: "number", min: 10, max: 480, required: true, value: durationMinutes, onChange: (event) => setDurationMinutes(Number(event.target.value)), error: serverError('durationMinutes'), hint: "Drives the workspace timer. It does not cut the session off." })] })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Question set", subtitle: availableQuestions.length
                                        ? `${selectedQuestionIds.length} selected · click to add, click again to remove`
                                        : undefined, actions: _jsx(LinkButton, { to: "/questions/new", variant: "secondary", size: "sm", children: "New question" }) }), _jsx(CardBody, { children: availableQuestions.length === 0 ? (_jsx(EmptyState, { icon: "\u2751", title: questions.length === 0
                                            ? 'The question library is empty'
                                            : `No questions support ${titleCase(language)}`, body: questions.length === 0
                                            ? 'Add a question with test cases first, then attach it here.'
                                            : 'Pick another language, or add a question that supports this one.', actions: _jsx(LinkButton, { to: "/questions/new", variant: "primary", size: "sm", children: "Create a question" }) })) : (_jsx("div", { className: styles.questionPicker, children: availableQuestions.map((question) => {
                                            const order = selectedQuestionIds.indexOf(question.id);
                                            const selected = order !== -1;
                                            return (_jsxs("div", { role: "checkbox", "aria-checked": selected, tabIndex: 0, className: [styles.pickerRow, selected ? styles.pickerRowSelected : '']
                                                    .filter(Boolean)
                                                    .join(' '), onClick: () => toggleQuestion(question.id), onKeyDown: (event) => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault();
                                                        toggleQuestion(question.id);
                                                    }
                                                }, children: [_jsx("span", { className: styles.pickerOrder, children: selected ? order + 1 : '' }), _jsxs("div", { className: styles.pickerMain, children: [_jsx("div", { className: styles.pickerTitle, children: question.title }), _jsxs("div", { className: styles.pickerMeta, children: [_jsx(Badge, { tone: difficultyTone[question.difficulty] ?? 'neutral', children: titleCase(question.difficulty) }), _jsxs("span", { children: [question.testCaseCount, " test", question.testCaseCount === 1 ? '' : 's'] }), question.testCaseCount === 0 && (_jsx(Badge, { tone: "warning", children: "no tests" })), _jsx("span", { children: question.categories.map(titleCase).join(', ') })] })] })] }, question.id));
                                        }) })) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "People", subtitle: "You are added as an interviewer automatically" }), _jsx(CardBody, { children: _jsxs("div", { className: styles.formGrid, children: [staff.length > 0 && (_jsxs("div", { children: [_jsx("div", { style: {
                                                            fontSize: 'var(--text-sm)',
                                                            fontWeight: 'var(--weight-medium)',
                                                            color: 'var(--text-secondary)',
                                                            marginBottom: 'var(--space-2)',
                                                        }, children: "Additional interviewers" }), _jsx("div", { className: styles.questionPicker, style: { maxHeight: 180 }, children: staff.map((member) => {
                                                            const selected = interviewerIds.includes(member.userId);
                                                            return (_jsxs("div", { role: "checkbox", "aria-checked": selected, tabIndex: 0, className: [styles.pickerRow, selected ? styles.pickerRowSelected : '']
                                                                    .filter(Boolean)
                                                                    .join(' '), onClick: () => toggleInterviewer(member.userId), onKeyDown: (event) => {
                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                        event.preventDefault();
                                                                        toggleInterviewer(member.userId);
                                                                    }
                                                                }, children: [_jsx("span", { className: styles.pickerOrder, children: selected ? '✓' : '' }), _jsxs("div", { className: styles.pickerMain, children: [_jsx("div", { className: styles.pickerTitle, children: member.name }), _jsxs("div", { className: styles.pickerMeta, children: [_jsx("span", { children: member.email }), _jsx(Badge, { tone: "neutral", children: titleCase(member.role) })] })] })] }, member.userId));
                                                        }) })] })), _jsxs("div", { className: styles.formRow, children: [_jsxs(Select, { label: "Candidate (existing member)", optional: true, value: candidateUserId, onChange: (event) => setCandidateUserId(event.target.value), hint: candidates.length
                                                            ? 'Pick someone who already accepted an invitation.'
                                                            : 'No candidate accounts yet — use the email field and send an invite instead.', children: [_jsx("option", { value: "", children: "Not selected" }), candidates.map((member) => (_jsxs("option", { value: member.userId, children: [member.name, " \u00B7 ", member.email] }, member.userId)))] }), _jsx(Input, { label: "Candidate email", type: "email", optional: true, value: candidateEmail, onChange: (event) => setCandidateEmail(event.target.value), error: serverError('candidateEmail'), hint: "Recorded on the interview so you can send the invite link afterwards." })] }), _jsx(Textarea, { label: "Private interviewer notes", optional: true, value: privateNotes, onChange: (event) => setPrivateNotes(event.target.value), placeholder: "What you want to probe, context from the CV, anything the candidate should not see.", hint: "Never shown to the candidate." })] }) })] }), _jsxs("div", { className: styles.formActions, children: [_jsx(LinkButton, { to: "/interviews", variant: "ghost", size: "md", children: "Cancel" }), _jsx(Button, { type: "submit", variant: "primary", size: "md", loading: submitting, disabled: !title.trim() || !language, children: "Create interview" })] })] }) })] }));
}
