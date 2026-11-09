import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { LoadingBlock } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useAuthStore } from '../../store/auth';
import { AuthLayout } from './AuthLayout';
import styles from './Auth.module.css';
const ROLE_COPY = {
    ADMIN: 'Administrator',
    INTERVIEWER: 'Interviewer',
    CANDIDATE: 'Candidate',
};
export function InvitePage() {
    const { token = '' } = useParams();
    const navigate = useNavigate();
    const acceptInvitation = useAuthStore((s) => s.acceptInvitation);
    const [preview, setPreview] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await api.get(`/api/auth/invitations/${token}`, {
                    skipRefresh: true,
                });
                if (!cancelled)
                    setPreview(data);
            }
            catch (err) {
                if (!cancelled) {
                    setLoadError(err instanceof ApiError
                        ? err.message
                        : 'Could not load this invitation. Check the link and try again.');
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [token]);
    const onSubmit = async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const result = await acceptInvitation({
                token,
                ...(name.trim() ? { name: name.trim() } : {}),
                ...(preview?.requiresPassword ? { password } : {}),
            });
            navigate(result.interviewId ? `/interviews/${result.interviewId}/workspace` : '/', {
                replace: true,
            });
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not accept the invitation. Please try again.');
        }
        finally {
            setSubmitting(false);
        }
    };
    if (loadError) {
        return (_jsx(AuthLayout, { title: "Invitation unavailable", subtitle: "This link cannot be used.", footer: _jsxs(_Fragment, { children: ["Already have an account? ", _jsx(Link, { to: "/login", children: "Sign in" })] }), children: _jsx("div", { className: styles.formError, role: "alert", children: loadError }) }));
    }
    if (!preview) {
        return (_jsx(AuthLayout, { title: "Checking your invitation\u2026", children: _jsx(LoadingBlock, { label: "Loading invitation" }) }));
    }
    return (_jsxs(AuthLayout, { title: `Join ${preview.organizationName}`, subtitle: preview.requiresPassword
            ? 'Choose a password to finish setting up your account.'
            : 'You already have a HireFO account. Accept to join this organization.', footer: _jsxs(_Fragment, { children: ["Wrong account? ", _jsx(Link, { to: "/login", children: "Sign in as someone else" })] }), children: [_jsxs("div", { className: styles.inviteMeta, children: [_jsxs("div", { className: styles.inviteRow, children: [_jsx("span", { className: styles.inviteLabel, children: "Email" }), _jsx("span", { className: styles.inviteValue, children: preview.email })] }), _jsxs("div", { className: styles.inviteRow, children: [_jsx("span", { className: styles.inviteLabel, children: "Role" }), _jsx("span", { className: styles.inviteValue, children: ROLE_COPY[preview.role] ?? preview.role })] }), preview.interviewTitle && (_jsxs("div", { className: styles.inviteRow, children: [_jsx("span", { className: styles.inviteLabel, children: "Interview" }), _jsx("span", { className: styles.inviteValue, children: preview.interviewTitle })] })), _jsxs("div", { className: styles.inviteRow, children: [_jsx("span", { className: styles.inviteLabel, children: "Link expires" }), _jsx("span", { className: styles.inviteValue, children: formatDateTime(preview.expiresAt) })] })] }), _jsxs("form", { className: styles.form, onSubmit: onSubmit, noValidate: true, children: [error && (_jsx("div", { className: styles.formError, role: "alert", children: error })), preview.requiresPassword && (_jsxs(_Fragment, { children: [_jsx(Input, { label: "Your name", name: "name", autoComplete: "name", value: name, onChange: (event) => setName(event.target.value), optional: true, placeholder: preview.email.split('@')[0] }), _jsx(Input, { label: "Choose a password", type: "password", name: "password", autoComplete: "new-password", required: true, value: password, onChange: (event) => setPassword(event.target.value), hint: "At least 12 characters, with a letter and a number." })] })), _jsx(Button, { type: "submit", variant: "primary", size: "lg", block: true, loading: submitting, children: preview.interviewTitle ? 'Accept and open interview' : 'Accept invitation' })] })] }));
}
