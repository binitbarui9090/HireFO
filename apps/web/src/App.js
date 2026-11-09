import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { Callout, LoadingBlock } from './components/ui/Primitives';
import { Toaster } from './components/ui/Toaster';
import { InvitePage } from './features/auth/InvitePage';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { EvaluationPage } from './features/evaluation/EvaluationPage';
import { InterviewCreatePage } from './features/interviews/InterviewCreatePage';
import { InterviewDetailPage } from './features/interviews/InterviewDetailPage';
import { InterviewListPage } from './features/interviews/InterviewListPage';
import { QuestionEditorPage } from './features/questions/QuestionEditorPage';
import { QuestionLibraryPage } from './features/questions/QuestionLibraryPage';
import { AuditPage } from './features/settings/AuditPage';
import { TeamPage } from './features/settings/TeamPage';
import { UsagePage } from './features/settings/UsagePage';
import { WorkspacePage } from './features/workspace/WorkspacePage';
import { useAuthStore, useIsStaff } from './store/auth';
import { useCapabilitiesStore } from './store/capabilities';
function RequireAuth({ children }) {
    const status = useAuthStore((s) => s.status);
    const location = useLocation();
    if (status === 'loading')
        return _jsx(LoadingBlock, { label: "Restoring your session\u2026" });
    if (status === 'anonymous') {
        return _jsx(Navigate, { to: "/login", replace: true, state: { from: location.pathname } });
    }
    return _jsx(_Fragment, { children: children });
}
/** Guards interviewer/admin-only routes; candidates are sent back to their list. */
function RequireStaff({ children }) {
    const isStaff = useIsStaff();
    if (!isStaff)
        return _jsx(Navigate, { to: "/interviews", replace: true });
    return _jsx(_Fragment, { children: children });
}
function RedirectIfSignedIn({ children }) {
    const status = useAuthStore((s) => s.status);
    if (status === 'loading')
        return _jsx(LoadingBlock, { label: "Loading\u2026" });
    if (status === 'authenticated')
        return _jsx(Navigate, { to: "/", replace: true });
    return _jsx(_Fragment, { children: children });
}
function NotFound() {
    return (_jsx(Callout, { tone: "neutral", title: "Page not found", children: "That page does not exist. Use the navigation on the left to get back on track." }));
}
export function App() {
    const bootstrap = useAuthStore((s) => s.bootstrap);
    const loadCapabilities = useCapabilitiesStore((s) => s.load);
    const capabilitiesError = useCapabilitiesStore((s) => s.error);
    useEffect(() => {
        void loadCapabilities();
        void bootstrap();
    }, [bootstrap, loadCapabilities]);
    return (_jsxs(BrowserRouter, { children: [capabilitiesError && (_jsx("div", { style: { padding: 'var(--space-4)' }, children: _jsx(Callout, { tone: "danger", title: "Backend unreachable", children: capabilitiesError }) })), _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(RedirectIfSignedIn, { children: _jsx(LoginPage, {}) }) }), _jsx(Route, { path: "/register", element: _jsx(RedirectIfSignedIn, { children: _jsx(RegisterPage, {}) }) }), _jsx(Route, { path: "/invite/:token", element: _jsx(InvitePage, {}) }), _jsx(Route, { path: "/interviews/:id/workspace", element: _jsx(RequireAuth, { children: _jsx(WorkspacePage, {}) }) }), _jsxs(Route, { path: "/", element: _jsx(RequireAuth, { children: _jsx(AppShell, {}) }), children: [_jsx(Route, { index: true, element: _jsx(DashboardPage, {}) }), _jsx(Route, { path: "interviews", element: _jsx(InterviewListPage, {}) }), _jsx(Route, { path: "interviews/new", element: _jsx(RequireStaff, { children: _jsx(InterviewCreatePage, {}) }) }), _jsx(Route, { path: "interviews/:id", element: _jsx(InterviewDetailPage, {}) }), _jsx(Route, { path: "interviews/:id/evaluation", element: _jsx(RequireStaff, { children: _jsx(EvaluationPage, {}) }) }), _jsx(Route, { path: "questions", element: _jsx(RequireStaff, { children: _jsx(QuestionLibraryPage, {}) }) }), _jsx(Route, { path: "questions/new", element: _jsx(RequireStaff, { children: _jsx(QuestionEditorPage, {}) }) }), _jsx(Route, { path: "questions/:id", element: _jsx(RequireStaff, { children: _jsx(QuestionEditorPage, {}) }) }), _jsx(Route, { path: "settings/team", element: _jsx(RequireStaff, { children: _jsx(TeamPage, {}) }) }), _jsx(Route, { path: "settings/usage", element: _jsx(RequireStaff, { children: _jsx(UsagePage, {}) }) }), _jsx(Route, { path: "settings/audit", element: _jsx(RequireStaff, { children: _jsx(AuditPage, {}) }) }), _jsx(Route, { path: "*", element: _jsx(NotFound, {}) })] })] }), _jsx(Toaster, {})] }));
}
