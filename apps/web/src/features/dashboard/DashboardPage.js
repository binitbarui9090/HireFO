import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { LinkButton } from '../../components/ui/Button';
import { Avatar, Badge, Callout, Card, CardHeader, EmptyState, interviewStatusTone, LoadingBlock, Stat, } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatNumber, formatRelative, formatUsd, titleCase } from '../../lib/format';
import { useAuthStore, useIsStaff } from '../../store/auth';
import { useCapabilitiesStore } from '../../store/capabilities';
import styles from './Dashboard.module.css';
const STATUS_COLOR = {
    DRAFT: 'var(--text-tertiary)',
    SCHEDULED: 'var(--info)',
    IN_PROGRESS: 'var(--accent)',
    COMPLETED: 'var(--success)',
    CANCELLED: 'var(--danger)',
};
const STATUS_ORDER = ['SCHEDULED', 'IN_PROGRESS', 'DRAFT', 'COMPLETED', 'CANCELLED'];
/** Staff see organization-wide figures; candidates see only their own sessions. */
export function DashboardPage() {
    const user = useAuthStore((s) => s.user);
    const activeOrgId = useAuthStore((s) => s.activeOrgId);
    const isStaff = useIsStaff();
    const capabilities = useCapabilitiesStore((s) => s.data);
    const [overview, setOverview] = useState(null);
    const [mine, setMine] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                if (isStaff) {
                    const [overviewData, mineData] = await Promise.all([
                        api.get('/api/org/overview'),
                        api.get('/api/interviews?mine=true&pageSize=5'),
                    ]);
                    if (!cancelled) {
                        setOverview(overviewData);
                        setMine(mineData);
                    }
                }
                else {
                    const mineData = await api.get('/api/interviews?pageSize=10');
                    if (!cancelled)
                        setMine(mineData);
                }
            }
            catch (err) {
                if (!cancelled) {
                    setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.');
                }
            }
            finally {
                if (!cancelled)
                    setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isStaff, activeOrgId]);
    if (loading)
        return _jsx(LoadingBlock, { label: "Loading dashboard" });
    if (error) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Dashboard" }), _jsx(Callout, { tone: "danger", title: "Could not load the dashboard", children: error })] }));
    }
    const firstName = user?.name.split(' ')[0] ?? 'there';
    if (!isStaff) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: `Welcome, ${firstName}`, description: "Your interviews appear below. Open one when it is time to start \u2014 the interviewer will be in the same workspace." }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Your interviews", subtitle: `${mine?.total ?? 0} total` }), mine && mine.items.length > 0 ? (_jsx("div", { className: styles.list, children: mine.items.map((interview) => (_jsxs(Link, { to: `/interviews/${interview.id}`, className: styles.row, children: [_jsxs("div", { className: styles.rowMain, children: [_jsx("div", { className: styles.rowTitle, children: interview.title }), _jsxs("div", { className: styles.rowMeta, children: [_jsx("span", { children: titleCase(interview.language) }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: interview.scheduledAt
                                                            ? `Scheduled ${formatRelative(interview.scheduledAt)}`
                                                            : 'Not scheduled yet' })] })] }), _jsx(Badge, { tone: interviewStatusTone[interview.status] ?? 'neutral', dot: true, children: titleCase(interview.status) })] }, interview.id))) })) : (_jsx(EmptyState, { icon: "\u25A4", title: "No interviews yet", body: "When an interviewer schedules a session with you it will show up here." }))] })] }));
    }
    const statusTotal = Math.max(1, Object.values(overview?.interviewsByStatus ?? {}).reduce((sum, n) => sum + n, 0));
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: `Welcome back, ${firstName}`, description: "Everything below is counted from real records in this organization.", actions: _jsxs(_Fragment, { children: [_jsx(LinkButton, { to: "/questions/new", variant: "secondary", size: "md", children: "New question" }), _jsx(LinkButton, { to: "/interviews/new", variant: "primary", size: "md", children: "New interview" })] }) }), _jsxs("div", { className: styles.statGrid, children: [_jsx(Stat, { label: "Interviews", value: formatNumber(overview?.totalInterviews ?? 0), hint: `${overview?.interviewsByStatus['IN_PROGRESS'] ?? 0} in progress` }), _jsx(Stat, { label: "Active questions", value: formatNumber(overview?.activeQuestions ?? 0), hint: "in the library" }), _jsx(Stat, { label: "Code runs", value: formatNumber(overview?.codeRunsLast30Days ?? 0), hint: "last 30 days" }), _jsx(Stat, { label: "Team members", value: formatNumber(Object.values(overview?.membersByRole ?? {}).reduce((sum, n) => sum + n, 0)), hint: `${overview?.membersByRole['INTERVIEWER'] ?? 0} interviewers` }), _jsx(Stat, { label: "Copilot spend", value: capabilities?.ai.enabled ? formatUsd(overview?.ai.costUsdLast30Days ?? 0) : 'Disabled', hint: capabilities?.ai.enabled
                            ? `${formatNumber(overview?.ai.requestsLast30Days ?? 0)} requests, 30 days`
                            : 'AI_PROVIDER is not configured' })] }), _jsxs("div", { className: styles.columns, children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Upcoming and live", subtitle: "Scheduled or in progress", actions: _jsx(LinkButton, { to: "/interviews", variant: "secondary", size: "sm", children: "View all" }) }), overview && overview.upcoming.length > 0 ? (_jsx("div", { className: styles.list, children: overview.upcoming.map((interview) => (_jsxs(Link, { to: `/interviews/${interview.id}`, className: styles.row, children: [_jsxs("div", { className: styles.rowMain, children: [_jsx("div", { className: styles.rowTitle, children: interview.title }), _jsxs("div", { className: styles.rowMeta, children: [_jsx("span", { children: titleCase(interview.language) }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: interview.scheduledAt
                                                                ? formatRelative(interview.scheduledAt)
                                                                : 'no date set' }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: interview.participants.filter((p) => p.role === 'CANDIDATE').length
                                                                ? `candidate: ${interview.participants.find((p) => p.role === 'CANDIDATE')?.name}`
                                                                : 'no candidate yet' })] })] }), _jsx(Badge, { tone: interviewStatusTone[interview.status] ?? 'neutral', dot: true, children: titleCase(interview.status) })] }, interview.id))) })) : (_jsx(EmptyState, { icon: "\u25A4", title: "Nothing scheduled", body: "Create an interview, attach a question or two, then invite the candidate.", actions: _jsx(LinkButton, { to: "/interviews/new", variant: "primary", size: "sm", children: "New interview" }) }))] }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }, children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "By status", subtitle: "All interviews" }), overview && overview.totalInterviews > 0 ? (_jsx("div", { className: styles.statusBreakdown, children: STATUS_ORDER.filter((status) => overview.interviewsByStatus[status]).map((status) => {
                                            const count = overview.interviewsByStatus[status] ?? 0;
                                            return (_jsxs("div", { className: styles.breakdownRow, children: [_jsx("span", { className: styles.breakdownLabel, children: titleCase(status) }), _jsx("span", { className: styles.breakdownTrack, children: _jsx("span", { className: styles.breakdownFill, style: {
                                                                width: `${(count / statusTotal) * 100}%`,
                                                                background: STATUS_COLOR[status],
                                                            } }) }), _jsx("span", { className: styles.breakdownCount, children: count })] }, status));
                                        }) })) : (_jsx(EmptyState, { icon: "\u25A6", title: "No data yet", body: "Status counts appear once you create interviews." }))] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Recently completed", subtitle: "Awaiting or holding evaluations" }), overview && overview.recentlyCompleted.length > 0 ? (_jsx("div", { className: styles.list, children: overview.recentlyCompleted.map((interview) => (_jsxs(Link, { to: `/interviews/${interview.id}/evaluation`, className: styles.row, children: [_jsxs("div", { className: styles.rowMain, children: [_jsx("div", { className: styles.rowTitle, children: interview.title }), _jsx("div", { className: styles.rowMeta, children: _jsxs("span", { children: ["ended ", formatRelative(interview.endedAt)] }) })] }), _jsx(Badge, { tone: interview.submittedEvaluationCount > 0 ? 'success' : 'warning', dot: true, children: interview.submittedEvaluationCount > 0
                                                        ? `${interview.submittedEvaluationCount} submitted`
                                                        : 'evaluation pending' })] }, interview.id))) })) : (_jsx(EmptyState, { icon: "\u2713", title: "Nothing completed yet", body: "Completed interviews and their evaluation status appear here." }))] })] })] }), mine && mine.items.length > 0 && (_jsxs(Card, { style: { marginTop: 'var(--space-5)' }, children: [_jsx(CardHeader, { title: "Your sessions", subtitle: "Interviews you are assigned to" }), _jsx("div", { className: styles.list, children: mine.items.map((interview) => (_jsxs(Link, { to: `/interviews/${interview.id}`, className: styles.row, children: [_jsxs("div", { className: styles.rowMain, children: [_jsx("div", { className: styles.rowTitle, children: interview.title }), _jsxs("div", { className: styles.rowMeta, children: [_jsx("span", { children: titleCase(interview.language) }), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: interview.scheduledAt ? formatRelative(interview.scheduledAt) : 'no date set' })] })] }), _jsx("div", { className: styles.avatars, children: interview.participants.slice(0, 4).map((p) => (_jsx(Avatar, { name: p.name, colorIndex: p.avatarColor, size: "sm", ring: true, title: `${p.name} (${p.role.toLowerCase()})` }, p.userId))) }), _jsx(Badge, { tone: interviewStatusTone[interview.status] ?? 'neutral', dot: true, children: titleCase(interview.status) })] }, interview.id))) })] }))] }));
}
