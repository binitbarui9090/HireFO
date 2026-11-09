import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Avatar, Badge, Callout, Card, CardHeader, EmptyState, LoadingBlock, } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatRelative, titleCase } from '../../lib/format';
import { useActiveRole, useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import styles from './Settings.module.css';
const statusTone = {
    ACCEPTED: 'success',
    PENDING: 'warning',
    EXPIRED: 'neutral',
    REVOKED: 'danger',
};
export function TeamPage() {
    const role = useActiveRole();
    const currentUser = useAuthStore((s) => s.user);
    const isAdmin = role === 'ADMIN';
    const [members, setMembers] = useState([]);
    const [invitations, setInvitations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);
    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('CANDIDATE');
    const [inviting, setInviting] = useState(false);
    const [inviteError, setInviteError] = useState(null);
    const [inviteResult, setInviteResult] = useState(null);
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [memberData, invitationData] = await Promise.all([
                api.get('/api/org/members'),
                api.get('/api/org/invitations'),
            ]);
            setMembers(memberData.items);
            setInvitations(invitationData.items);
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not load the team.');
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        void load();
    }, [load]);
    const changeRole = async (userId, nextRole) => {
        setBusy(userId);
        try {
            await api.patch(`/api/org/members/${userId}`, { role: nextRole });
            toast.success('Role updated');
            await load();
        }
        catch (err) {
            toast.error('Could not change the role', err instanceof ApiError ? err.message : undefined);
        }
        finally {
            setBusy(null);
        }
    };
    const suspend = async (userId) => {
        setBusy(userId);
        try {
            await api.delete(`/api/org/members/${userId}`);
            toast.success('Member suspended', 'Their interviews and audit history are kept.');
            await load();
        }
        catch (err) {
            toast.error('Could not suspend', err instanceof ApiError ? err.message : undefined);
        }
        finally {
            setBusy(null);
        }
    };
    const revoke = async (invitationId) => {
        setBusy(invitationId);
        try {
            await api.post(`/api/org/invitations/${invitationId}/revoke`);
            toast.success('Invitation revoked');
            await load();
        }
        catch (err) {
            toast.error('Could not revoke', err instanceof ApiError ? err.message : undefined);
        }
        finally {
            setBusy(null);
        }
    };
    const createInvite = async (event) => {
        event?.preventDefault();
        setInviting(true);
        setInviteError(null);
        setInviteResult(null);
        try {
            const result = await api.post('/api/org/invitations', {
                email: inviteEmail.trim(),
                role: inviteRole,
            });
            setInviteResult(result);
            await load();
        }
        catch (err) {
            setInviteError(err instanceof ApiError ? err.message : 'Could not create the invitation.');
        }
        finally {
            setInviting(false);
        }
    };
    if (loading)
        return _jsx(LoadingBlock, { label: "Loading team" });
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Team & invites", description: "Members of this organization and the invitation links you have generated. Data never crosses organization boundaries.", actions: _jsx(Button, { variant: "primary", size: "md", onClick: () => {
                        setInviteResult(null);
                        setInviteError(null);
                        setInviteEmail('');
                        setInviteOpen(true);
                    }, children: "Invite someone" }) }), error && (_jsx(Callout, { tone: "danger", title: "Could not load the team", children: error })), _jsxs("div", { className: styles.sections, children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Members", subtitle: `${members.length} total` }), _jsx("div", { className: styles.tableScroll, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Member" }), _jsx("th", { children: "Role" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Last sign-in" }), _jsx("th", { children: "Joined" }), isAdmin && _jsx("th", { "aria-label": "Actions" })] }) }), _jsx("tbody", { children: members.map((member) => (_jsxs("tr", { children: [_jsx("td", { children: _jsxs("div", { className: styles.userCell, children: [_jsx(Avatar, { name: member.name, colorIndex: member.avatarColor, size: "md" }), _jsxs("div", { children: [_jsxs("div", { className: styles.userName, children: [member.name, member.userId === currentUser?.id && ' (you)'] }), _jsx("div", { className: styles.userEmail, children: member.email })] })] }) }), _jsx("td", { children: isAdmin && member.userId !== currentUser?.id ? (_jsxs("select", { className: styles.roleSelect, value: member.role, disabled: busy === member.userId, onChange: (event) => void changeRole(member.userId, event.target.value), "aria-label": `Role for ${member.name}`, children: [_jsx("option", { value: "ADMIN", children: "Admin" }), _jsx("option", { value: "INTERVIEWER", children: "Interviewer" }), _jsx("option", { value: "CANDIDATE", children: "Candidate" })] })) : (_jsx(Badge, { tone: member.role === 'ADMIN' ? 'accent' : 'neutral', children: titleCase(member.role) })) }), _jsx("td", { children: _jsx(Badge, { tone: member.status === 'ACTIVE'
                                                                ? 'success'
                                                                : member.status === 'SUSPENDED'
                                                                    ? 'danger'
                                                                    : 'warning', dot: true, children: titleCase(member.status) }) }), _jsx("td", { className: styles.muted, children: member.lastLoginAt ? formatRelative(member.lastLoginAt) : 'never' }), _jsx("td", { className: styles.muted, children: formatRelative(member.joinedAt) }), isAdmin && (_jsx("td", { className: styles.actionsCell, children: member.userId !== currentUser?.id && member.status === 'ACTIVE' && (_jsx(Button, { variant: "dangerGhost", size: "sm", loading: busy === member.userId, onClick: () => void suspend(member.userId), children: "Suspend" })) }))] }, member.membershipId))) })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Invitations", subtitle: "Links are shown once at creation and stored only as a hash" }), invitations.length > 0 ? (_jsx("div", { className: styles.tableScroll, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Email" }), _jsx("th", { children: "Role" }), _jsx("th", { children: "Interview" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Expires" }), _jsx("th", { children: "Invited by" }), _jsx("th", { "aria-label": "Actions" })] }) }), _jsx("tbody", { children: invitations.map((invitation) => (_jsxs("tr", { children: [_jsx("td", { className: styles.userEmail, children: invitation.email }), _jsx("td", { children: _jsx(Badge, { tone: "neutral", children: titleCase(invitation.role) }) }), _jsx("td", { className: styles.muted, children: invitation.interview?.title ?? '—' }), _jsx("td", { children: _jsx(Badge, { tone: statusTone[invitation.status] ?? 'neutral', dot: true, children: titleCase(invitation.status) }) }), _jsx("td", { className: styles.muted, children: formatRelative(invitation.expiresAt) }), _jsx("td", { className: styles.muted, children: invitation.createdBy.name }), _jsx("td", { className: styles.actionsCell, children: invitation.status === 'PENDING' && (_jsx(Button, { variant: "ghost", size: "sm", loading: busy === invitation.id, onClick: () => void revoke(invitation.id), children: "Revoke" })) })] }, invitation.id))) })] }) })) : (_jsx(EmptyState, { icon: "\u25C9", title: "No invitations yet", body: "Invite an interviewer or a candidate; HireFO generates a one-time link for you to send." }))] })] }), _jsx(Modal, { open: inviteOpen, onClose: () => setInviteOpen(false), title: "Invite someone", description: "No email is sent \u2014 HireFO has no mail transport configured. Copy the link and send it yourself.", footer: inviteResult ? (_jsx(Button, { variant: "primary", onClick: () => setInviteOpen(false), children: "Done" })) : (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: () => setInviteOpen(false), children: "Cancel" }), _jsx(Button, { variant: "primary", loading: inviting, disabled: !inviteEmail.trim(), onClick: () => void createInvite(), children: "Create link" })] })), children: inviteResult ? (_jsxs("div", { className: styles.inviteResult, children: [_jsx(Callout, { tone: "warning", title: "Copy this link now", children: inviteResult.note }), _jsxs("div", { className: styles.inviteLink, children: [_jsx("input", { className: styles.inviteLinkInput, readOnly: true, value: inviteResult.url, onFocus: (event) => event.target.select(), "aria-label": "Invitation link" }), _jsx(Button, { variant: "secondary", onClick: () => {
                                        void navigator.clipboard
                                            .writeText(inviteResult.url)
                                            .then(() => toast.success('Link copied'))
                                            .catch(() => toast.warning('Could not copy', 'Select the link and copy it.'));
                                    }, children: "Copy" })] }), _jsxs("p", { style: { fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }, children: ["For ", inviteResult.email, " as ", titleCase(inviteResult.role), ". Expires", ' ', formatDateTime(inviteResult.expiresAt), "."] })] })) : (_jsxs("form", { onSubmit: (event) => void createInvite(event), style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }, children: [inviteError && (_jsx(Callout, { tone: "danger", title: "Could not create the link", children: inviteError })), _jsx(Input, { label: "Email", type: "email", required: true, value: inviteEmail, onChange: (event) => setInviteEmail(event.target.value), placeholder: "person@example.com" }), _jsxs(Select, { label: "Role", value: inviteRole, onChange: (event) => setInviteRole(event.target.value), hint: isAdmin
                                ? 'Admins manage the team. Interviewers run sessions. Candidates see only their own interviews.'
                                : 'Only admins can invite interviewers or admins.', children: [_jsx("option", { value: "CANDIDATE", children: "Candidate" }), isAdmin && _jsx("option", { value: "INTERVIEWER", children: "Interviewer" }), isAdmin && _jsx("option", { value: "ADMIN", children: "Admin" })] })] })) })] }));
}
