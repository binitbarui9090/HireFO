import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { INTERVIEW_STATUSES } from '@hirefo/shared';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button, LinkButton } from '../../components/ui/Button';
import { Avatar, Badge, Callout, Card, EmptyState, interviewStatusTone, LoadingBlock, } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatRelative, pluralise, titleCase } from '../../lib/format';
import { useAuthStore, useIsStaff } from '../../store/auth';
import styles from './Interviews.module.css';
const PAGE_SIZE = 20;
export function InterviewListPage() {
    const isStaff = useIsStaff();
    const activeOrgId = useAuthStore((s) => s.activeOrgId);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [status, setStatus] = useState('');
    const [mineOnly, setMineOnly] = useState(false);
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
        const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (debouncedSearch)
            params.set('search', debouncedSearch);
        if (status)
            params.set('status', status);
        if (mineOnly)
            params.set('mine', 'true');
        try {
            setData(await api.get(`/api/interviews?${params.toString()}`));
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not load interviews.');
        }
        finally {
            setLoading(false);
        }
    }, [page, debouncedSearch, status, mineOnly]);
    useEffect(() => {
        void load();
    }, [load, activeOrgId]);
    const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Interviews", description: isStaff
                    ? 'Every interview in this organization. Open one to manage its question set, invite the candidate, or jump into the workspace.'
                    : 'The interviews you are taking part in.', actions: isStaff ? (_jsx(LinkButton, { to: "/interviews/new", variant: "primary", size: "md", children: "New interview" })) : undefined }), _jsxs("div", { className: styles.toolbar, children: [_jsx("input", { className: styles.search, type: "search", placeholder: "Search by title\u2026", value: search, onChange: (event) => setSearch(event.target.value), "aria-label": "Search interviews" }), _jsxs("select", { className: styles.filter, value: status, onChange: (event) => {
                            setStatus(event.target.value);
                            setPage(1);
                        }, "aria-label": "Filter by status", children: [_jsx("option", { value: "", children: "All statuses" }), INTERVIEW_STATUSES.map((s) => (_jsx("option", { value: s, children: titleCase(s) }, s)))] }), isStaff && (_jsx(Button, { variant: mineOnly ? 'primary' : 'secondary', size: "md", onClick: () => {
                            setMineOnly((v) => !v);
                            setPage(1);
                        }, "aria-pressed": mineOnly, children: "Assigned to me" }))] }), error && (_jsx(Callout, { tone: "danger", title: "Could not load interviews", children: error })), loading && !data ? (_jsx(LoadingBlock, { label: "Loading interviews" })) : data && data.items.length > 0 ? (_jsxs(Card, { children: [_jsx("div", { className: styles.tableScroll, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Interview" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Scheduled" }), _jsx("th", { children: "Questions" }), _jsx("th", { children: "Runs" }), _jsx("th", { children: "People" }), _jsx("th", { "aria-label": "Actions" })] }) }), _jsx("tbody", { children: data.items.map((interview) => (_jsxs("tr", { children: [_jsxs("td", { className: styles.titleCell, children: [_jsx(Link, { to: `/interviews/${interview.id}`, className: styles.titleLink, children: interview.title }), _jsxs("div", { className: styles.titleMeta, children: [titleCase(interview.language), " \u00B7 ", interview.durationMinutes, " min", interview.difficulty ? ` · ${titleCase(interview.difficulty)}` : ''] })] }), _jsx("td", { children: _jsx(Badge, { tone: interviewStatusTone[interview.status] ?? 'neutral', dot: true, children: titleCase(interview.status) }) }), _jsx("td", { className: styles.numeric, children: interview.scheduledAt ? (_jsx("span", { title: formatDateTime(interview.scheduledAt), children: formatRelative(interview.scheduledAt) })) : ('—') }), _jsx("td", { className: styles.numeric, children: interview.questionCount }), _jsx("td", { className: styles.numeric, children: interview.submissionCount }), _jsx("td", { children: _jsx("div", { className: styles.avatars, children: interview.participants.slice(0, 4).map((p) => (_jsx(Avatar, { name: p.name, colorIndex: p.avatarColor, size: "sm", ring: true, title: `${p.name} (${p.role.toLowerCase()})` }, p.userId))) }) }), _jsx("td", { className: styles.actionsCell, children: interview.status !== 'CANCELLED' && (_jsx(LinkButton, { to: `/interviews/${interview.id}/workspace`, size: "sm", variant: interview.status === 'IN_PROGRESS' ? 'primary' : 'secondary', children: interview.status === 'IN_PROGRESS' ? 'Join' : 'Open' })) })] }, interview.id))) })] }) }), _jsxs("div", { className: styles.pagination, children: [_jsxs("span", { children: [data.total, " ", pluralise(data.total, 'interview'), " \u00B7 page ", data.page, " of ", totalPages] }), _jsxs("div", { className: styles.pageButtons, children: [_jsx(Button, { size: "sm", variant: "secondary", disabled: page <= 1 || loading, onClick: () => setPage((p) => Math.max(1, p - 1)), children: "Previous" }), _jsx(Button, { size: "sm", variant: "secondary", disabled: page >= totalPages || loading, onClick: () => setPage((p) => p + 1), children: "Next" })] })] })] })) : (_jsx(Card, { children: _jsx(EmptyState, { icon: "\u25A4", title: debouncedSearch || status || mineOnly
                        ? 'No interviews match those filters'
                        : 'No interviews yet', body: debouncedSearch || status || mineOnly
                        ? 'Try clearing the search or the status filter.'
                        : isStaff
                            ? 'Create an interview, attach questions from the library, then send the candidate an invitation link.'
                            : 'When an interviewer schedules a session with you it will appear here.', actions: isStaff && !debouncedSearch && !status && !mineOnly ? (_jsx(LinkButton, { to: "/interviews/new", variant: "primary", size: "sm", children: "New interview" })) : undefined }) }))] }));
}
