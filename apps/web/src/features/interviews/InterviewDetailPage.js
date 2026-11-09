import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button, LinkButton } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Avatar, Badge, Callout, Card, CardBody, CardHeader, difficultyTone, EmptyState, interviewStatusTone, LoadingBlock, } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatRelative, titleCase } from '../../lib/format';
import { toast } from '../../store/toast';
import styles from './Interviews.module.css';
export function InterviewDetailPage() {
    const { id = '' } = useParams();
    const navigate = useNavigate();
    const [interview, setInterview] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);
    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('CANDIDATE');
    const [inviteResult, setInviteResult] = useState(null);
    const [inviteError, setInviteError] = useState(null);
    const [inviting, setInviting] = useState(false);
    const [cancelOpen, setCancelOpen] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setInterview(await api.get(`/api/interviews/${id}`));
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not load the interview.');
        }
        finally {
            setLoading(false);
        }
    }, [id]);
    useEffect(() => {
        void load();
    }, [load]);
    const transition = async (action) => {
        setBusy(action);
        try {
            await api.post(`/api/interviews/${id}/${action}`);
            toast.success(action === 'start' ? 'Interview started' : 'Interview completed');
            await load();
            if (action === 'start')
                navigate(`/interviews/${id}/workspace`);
        }
        catch (err) {
            toast.error('Could not update the interview', err instanceof ApiError ? err.message : undefined);
        }
        finally {
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
        }
        catch (err) {
            toast.error('Could not cancel', err instanceof ApiError ? err.message : undefined);
        }
        finally {
            setBusy(null);
        }
    };
    const sendInvite = async (event) => {
        event?.preventDefault();
        setInviting(true);
        setInviteError(null);
        setInviteResult(null);
        try {
            const result = await api.post('/api/org/invitations', {
                email: inviteEmail.trim(),
                role: inviteRole,
                interviewId: id,
            });
            setInviteResult(result);
            await load();
        }
        catch (err) {
            setInviteError(err instanceof ApiError ? err.message : 'Could not create the invitation link.');
        }
        finally {
            setInviting(false);
        }
    };
    const copyInviteLink = async () => {
        if (!inviteResult)
            return;
        try {
            await navigator.clipboard.writeText(inviteResult.url);
            toast.success('Link copied');
        }
        catch {
            toast.warning('Could not copy automatically', 'Select the link and copy it manually.');
        }
    };
    if (loading && !interview)
        return _jsx(LoadingBlock, { label: "Loading interview" });
    if (error || !interview) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Interview", breadcrumbs: [{ label: 'Interviews', to: '/interviews' }] }), _jsx(Callout, { tone: "danger", title: "Could not load this interview", children: error ?? 'Not found.' })] }));
    }
    const { isStaff, status } = interview;
    const candidate = interview.participants.find((p) => p.role === 'CANDIDATE');
    const interviewers = interview.participants.filter((p) => p.role === 'INTERVIEWER');
    const canStart = isStaff && (status === 'DRAFT' || status === 'SCHEDULED');
    const canComplete = isStaff && status === 'IN_PROGRESS';
    const canCancel = isStaff && !['COMPLETED', 'CANCELLED'].includes(status);
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: _jsxs(_Fragment, { children: [interview.title, _jsx(Badge, { tone: interviewStatusTone[status] ?? 'neutral', dot: true, children: titleCase(status) })] }), description: `${titleCase(interview.language)} · ${interview.durationMinutes} minutes · created by ${interview.createdBy.name}`, breadcrumbs: [{ label: 'Interviews', to: '/interviews' }, { label: interview.title }], actions: _jsxs(_Fragment, { children: [isStaff && status === 'COMPLETED' && (_jsx(LinkButton, { to: `/interviews/${id}/evaluation`, variant: "secondary", size: "md", children: "Evaluation" })), canCancel && (_jsx(Button, { variant: "dangerGhost", size: "md", onClick: () => setCancelOpen(true), children: "Cancel" })), canComplete && (_jsx(Button, { variant: "secondary", size: "md", loading: busy === 'complete', onClick: () => void transition('complete'), children: "Mark complete" })), canStart && (_jsx(Button, { variant: "primary", size: "md", loading: busy === 'start', onClick: () => void transition('start'), children: "Start interview" })), status !== 'CANCELLED' && (_jsx(LinkButton, { to: `/interviews/${id}/workspace`, variant: status === 'IN_PROGRESS' ? 'primary' : 'secondary', size: "md", children: "Open workspace" }))] }) }), status === 'CANCELLED' && interview.cancelledReason && (_jsx(Callout, { tone: "warning", title: "This interview was cancelled", children: interview.cancelledReason })), _jsxs("div", { className: styles.detailGrid, style: { marginTop: 'var(--space-2)' }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }, children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Question set", subtitle: `${interview.questions.length} attached, run in this order` }), interview.questions.length > 0 ? (_jsx("div", { children: interview.questions.map((question, index) => (_jsxs("div", { className: styles.questionRow, children: [_jsx("span", { className: styles.questionIndex, children: index + 1 }), _jsxs("div", { className: styles.questionBody, children: [_jsx("div", { className: styles.questionTitle, children: question.title }), _jsxs("div", { className: styles.questionMeta, children: [_jsx(Badge, { tone: difficultyTone[question.difficulty] ?? 'neutral', children: titleCase(question.difficulty) }), _jsxs(Badge, { tone: "neutral", children: [question.testCaseCount, " test", question.testCaseCount === 1 ? '' : 's'] }), question.expectedComplexity && (_jsx(Badge, { tone: "info", children: question.expectedComplexity })), question.questionId === interview.activeQuestionId && (_jsx(Badge, { tone: "accent", dot: true, children: "active" }))] })] }), isStaff && (_jsx(LinkButton, { to: `/questions/${question.questionId}`, variant: "ghost", size: "sm", children: "Edit" }))] }, question.questionId))) })) : (_jsx(EmptyState, { icon: "\u2751", title: "No questions attached", body: "The workspace still works as a shared scratch editor, but there will be no test cases to run." }))] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Participants", subtitle: `${interviewers.length} interviewer${interviewers.length === 1 ? '' : 's'}${candidate ? ', 1 candidate' : ', no candidate yet'}`, actions: isStaff ? (_jsx(Button, { variant: "secondary", size: "sm", onClick: () => {
                                                setInviteResult(null);
                                                setInviteError(null);
                                                setInviteEmail(interview.candidateEmail ?? '');
                                                setInviteOpen(true);
                                            }, children: "Invite" })) : undefined }), _jsxs("div", { children: [interview.participants.map((participant) => (_jsxs("div", { className: styles.participantRow, children: [_jsx(Avatar, { name: participant.name, colorIndex: participant.avatarColor, size: "md", title: participant.name }), _jsxs("div", { className: styles.participantMain, children: [_jsx("div", { className: styles.participantName, children: participant.name }), _jsx("div", { className: styles.participantEmail, children: participant.email })] }), _jsx(Badge, { tone: participant.role === 'CANDIDATE' ? 'accent' : 'neutral', children: titleCase(participant.role) }), _jsx("span", { style: {
                                                            fontSize: 'var(--text-xs)',
                                                            color: 'var(--text-tertiary)',
                                                            minWidth: 90,
                                                            textAlign: 'right',
                                                        }, children: participant.joinedAt ? `joined ${formatRelative(participant.joinedAt)}` : 'not joined' })] }, participant.userId))), interview.participants.length === 0 && (_jsx(EmptyState, { icon: "\u25C9", title: "No participants yet" }))] })] }), isStaff && interview.invitations.length > 0 && (_jsxs(Card, { children: [_jsx(CardHeader, { title: "Pending invitations", subtitle: "Links already generated" }), _jsx("div", { children: interview.invitations.map((invitation) => (_jsxs("div", { className: styles.invitationRow, children: [_jsxs("div", { className: styles.invitationMain, children: [_jsx("div", { children: invitation.email }), _jsxs("div", { className: styles.invitationMeta, children: [titleCase(invitation.role), " \u00B7 expires ", formatRelative(invitation.expiresAt)] })] }), _jsx(Badge, { tone: invitation.acceptedAt ? 'success' : 'warning', dot: true, children: invitation.acceptedAt ? 'accepted' : 'pending' })] }, invitation.id))) })] }))] }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }, children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Details" }), _jsxs("div", { className: styles.metaList, children: [_jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Scheduled" }), _jsx("span", { className: styles.metaValue, children: formatDateTime(interview.scheduledAt) })] }), _jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Started" }), _jsx("span", { className: styles.metaValue, children: formatDateTime(interview.startedAt) })] }), _jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Ended" }), _jsx("span", { className: styles.metaValue, children: formatDateTime(interview.endedAt) })] }), _jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Duration" }), _jsxs("span", { className: styles.metaValue, children: [interview.durationMinutes, " min"] })] }), _jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Language" }), _jsx("span", { className: styles.metaValue, children: titleCase(interview.language) })] }), interview.difficulty && (_jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Difficulty" }), _jsx("span", { className: styles.metaValue, children: titleCase(interview.difficulty) })] })), interview.candidateEmail && (_jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Candidate email" }), _jsx("span", { className: styles.metaValue, children: interview.candidateEmail })] })), _jsxs("div", { className: styles.metaRow, children: [_jsx("span", { className: styles.metaLabel, children: "Created" }), _jsx("span", { className: styles.metaValue, children: formatDateTime(interview.createdAt) })] })] })] }), isStaff && (_jsxs(Card, { children: [_jsx(CardHeader, { title: "Private interviewer notes", subtitle: "Set when the interview was created. Never visible to the candidate." }), _jsx(CardBody, { children: interview.privateNotes ? (_jsx("p", { style: {
                                                fontSize: 'var(--text-sm)',
                                                color: 'var(--text-secondary)',
                                                whiteSpace: 'pre-wrap',
                                            }, children: interview.privateNotes })) : (_jsx("p", { style: { fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }, children: "None. Notes taken during the session live in the workspace panel instead." })) })] }))] })] }), _jsx(Modal, { open: inviteOpen, onClose: () => setInviteOpen(false), title: "Invite to this interview", description: "HireFO has no mail transport configured, so it generates a link for you to send yourself.", footer: inviteResult ? (_jsx(Button, { variant: "primary", onClick: () => setInviteOpen(false), children: "Done" })) : (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: () => setInviteOpen(false), children: "Cancel" }), _jsx(Button, { variant: "primary", loading: inviting, onClick: () => void sendInvite(), children: "Create link" })] })), children: inviteResult ? (_jsxs("div", { className: styles.inviteResult, children: [_jsx(Callout, { tone: "warning", title: "Copy this link now", children: inviteResult.note }), _jsxs("div", { className: styles.inviteLink, children: [_jsx("input", { className: styles.inviteLinkInput, readOnly: true, value: inviteResult.url, onFocus: (event) => event.target.select(), "aria-label": "Invitation link" }), _jsx(Button, { variant: "secondary", onClick: () => void copyInviteLink(), children: "Copy" })] }), _jsxs("p", { style: { fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }, children: ["For ", inviteResult.email, " as ", titleCase(inviteResult.role), ". Expires", ' ', formatDateTime(inviteResult.expiresAt), "."] })] })) : (_jsxs("form", { onSubmit: (event) => void sendInvite(event), style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }, children: [inviteError && (_jsx(Callout, { tone: "danger", title: "Could not create the link", children: inviteError })), _jsx(Input, { label: "Email", type: "email", required: true, value: inviteEmail, onChange: (event) => setInviteEmail(event.target.value), placeholder: "candidate@example.com" }), _jsxs(Select, { label: "Role", value: inviteRole, onChange: (event) => setInviteRole(event.target.value), hint: "Candidates see only this interview. Interviewers need the admin role to invite.", children: [_jsx("option", { value: "CANDIDATE", children: "Candidate" }), _jsx("option", { value: "INTERVIEWER", children: "Interviewer" })] })] })) }), _jsx(Modal, { open: cancelOpen, onClose: () => setCancelOpen(false), title: "Cancel this interview?", description: "The session can no longer be started and code can no longer be run. This cannot be undone.", size: "sm", dismissOnBackdrop: false, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: () => setCancelOpen(false), children: "Keep it" }), _jsx(Button, { variant: "danger", loading: busy === 'cancel', onClick: () => void cancelInterview(), children: "Cancel interview" })] }), children: _jsx(Textarea, { label: "Reason", optional: true, value: cancelReason, onChange: (event) => setCancelReason(event.target.value), placeholder: "Candidate withdrew, rescheduling, \u2026", hint: "Stored on the interview and shown on this page." }) })] }));
}
