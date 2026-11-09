import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge, Callout, Card, EmptyState, LoadingBlock, } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, pluralise } from '../../lib/format';
import styles from './Settings.module.css';
/** Colour the row by what kind of event it is, so denials stand out. */
function toneFor(action) {
    if (action.startsWith('access.denied') || action.endsWith('login_failed'))
        return 'danger';
    if (action.startsWith('auth.'))
        return 'accent';
    if (action.includes('cancel') || action.includes('revoke') || action.includes('remove')) {
        return 'warning';
    }
    if (action.includes('create') || action.includes('submit') || action.includes('accept')) {
        return 'success';
    }
    return 'neutral';
}
export function AuditPage() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [actionFilter, setActionFilter] = useState('');
    const [page, setPage] = useState(1);
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({ page: String(page), pageSize: '50' });
        if (actionFilter.trim())
            params.set('action', actionFilter.trim());
        try {
            setData(await api.get(`/api/org/audit?${params.toString()}`));
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not load the audit log.');
        }
        finally {
            setLoading(false);
        }
    }, [page, actionFilter]);
    useEffect(() => {
        void load();
    }, [load]);
    const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Audit log", description: "Append-only record of security- and data-relevant actions in this organization: sign-ins, permission denials, interview and question changes, code submissions, copilot requests and evaluations." }), _jsxs("div", { className: styles.toolbar, children: [_jsx("input", { className: styles.filterInput, placeholder: "Exact action, e.g. access.denied", value: actionFilter, onChange: (event) => {
                            setActionFilter(event.target.value);
                            setPage(1);
                        }, "aria-label": "Filter by action" }), _jsx(Button, { variant: "secondary", size: "md", onClick: () => void load(), loading: loading, children: "Refresh" })] }), error && (_jsx(Callout, { tone: "danger", title: "Could not load the audit log", children: error })), loading && !data ? (_jsx(LoadingBlock, { label: "Loading audit log" })) : data && data.items.length > 0 ? (_jsxs(Card, { children: [_jsx("div", { className: styles.tableScroll, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "When" }), _jsx("th", { children: "Action" }), _jsx("th", { children: "Actor" }), _jsx("th", { children: "Target" }), _jsx("th", { children: "Detail" }), _jsx("th", { children: "IP" })] }) }), _jsx("tbody", { children: data.items.map((event) => (_jsxs("tr", { children: [_jsx("td", { className: styles.muted, children: formatDateTime(event.createdAt) }), _jsx("td", { children: _jsx(Badge, { tone: toneFor(event.action), children: event.action }) }), _jsx("td", { children: event.actor ? (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.userName, children: event.actor.name }), _jsx("div", { className: styles.userEmail, children: event.actor.email })] })) : (_jsx("span", { className: styles.muted, children: "system / anonymous" })) }), _jsxs("td", { className: styles.mono, children: [event.targetType ? `${event.targetType}` : '—', event.targetId && (_jsx("div", { className: styles.muted, style: { fontSize: 'var(--text-2xs)' }, children: event.targetId }))] }), _jsx("td", { children: _jsx("div", { className: styles.auditMeta, children: Object.keys(event.metadata ?? {}).length > 0
                                                        ? JSON.stringify(event.metadata)
                                                        : '—' }) }), _jsx("td", { className: styles.mono, children: event.ip ?? '—' })] }, event.id))) })] }) }), _jsxs("div", { className: styles.pagination, children: [_jsxs("span", { children: [data.total, " ", pluralise(data.total, 'event'), " \u00B7 page ", data.page, " of ", totalPages] }), _jsxs("div", { className: styles.pageButtons, children: [_jsx(Button, { size: "sm", variant: "secondary", disabled: page <= 1 || loading, onClick: () => setPage((p) => Math.max(1, p - 1)), children: "Previous" }), _jsx(Button, { size: "sm", variant: "secondary", disabled: page >= totalPages || loading, onClick: () => setPage((p) => p + 1), children: "Next" })] })] })] })) : (_jsx(Card, { children: _jsx(EmptyState, { icon: "\u2399", title: actionFilter ? 'No events match that action' : 'No audit events yet', body: actionFilter
                        ? 'Action names are matched exactly — try "auth.login" or "interview.create".'
                        : 'Events are written as people use the platform.' }) }))] }));
}
