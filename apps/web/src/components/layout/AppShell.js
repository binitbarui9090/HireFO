import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Avatar } from '../ui/Primitives';
import { Button } from '../ui/Button';
import { useAuthStore, useIsStaff } from '../../store/auth';
import { useCapabilitiesStore } from '../../store/capabilities';
import { useThemeStore } from '../../store/theme';
import styles from './AppShell.module.css';
const PRIMARY_NAV = [
    { to: '/', label: 'Dashboard', icon: '▦' },
    { to: '/interviews', label: 'Interviews', icon: '▤' },
    { to: '/questions', label: 'Question library', icon: '❑', staffOnly: true },
];
const ADMIN_NAV = [
    { to: '/settings/team', label: 'Team & invites', icon: '◉', staffOnly: true },
    { to: '/settings/usage', label: 'Copilot usage', icon: '◴', staffOnly: true },
    { to: '/settings/audit', label: 'Audit log', icon: '⎙', adminOnly: true },
];
const themeIcon = { dark: '☾', light: '☀', system: '◐' };
export function AppShell() {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const location = useLocation();
    const user = useAuthStore((s) => s.user);
    const memberships = useAuthStore((s) => s.memberships);
    const activeOrgId = useAuthStore((s) => s.activeOrgId);
    const setActiveOrg = useAuthStore((s) => s.setActiveOrg);
    const logout = useAuthStore((s) => s.logout);
    const isStaff = useIsStaff();
    const capabilities = useCapabilitiesStore((s) => s.data);
    const cycleTheme = useThemeStore((s) => s.cycle);
    const themeMode = useThemeStore((s) => s.mode);
    const activeMembership = memberships.find((m) => m.organizationId === activeOrgId);
    const isAdmin = activeMembership?.role === 'ADMIN';
    const visible = (entry) => {
        if (entry.adminOnly)
            return isAdmin;
        if (entry.staffOnly)
            return isStaff;
        return true;
    };
    const renderNav = (entries) => entries.filter(visible).map((entry) => (_jsxs(NavLink, { to: entry.to, end: entry.to === '/', className: ({ isActive }) => [styles.navItem, isActive ? styles.navItemActive : ''].filter(Boolean).join(' '), onClick: () => setSidebarOpen(false), children: [_jsx("span", { className: styles.navIcon, "aria-hidden": "true", children: entry.icon }), entry.label] }, entry.to)));
    const adminEntries = ADMIN_NAV.filter(visible);
    return (_jsxs("div", { className: styles.shell, children: [_jsxs("aside", { className: [styles.sidebar, sidebarOpen ? styles.sidebarOpen : ''].filter(Boolean).join(' '), children: [_jsxs("div", { className: styles.brand, children: [_jsx("span", { className: styles.brandMark, "aria-hidden": "true", children: "H" }), _jsx("span", { className: styles.brandName, children: "HireFO" })] }), _jsx("div", { className: styles.orgSwitcher, children: memberships.length > 1 ? (_jsxs(_Fragment, { children: [_jsx("label", { className: "srOnly", htmlFor: "org-switcher", children: "Active organization" }), _jsx("select", { id: "org-switcher", className: styles.orgSelect, value: activeOrgId ?? '', onChange: (event) => setActiveOrg(event.target.value), children: memberships.map((m) => (_jsxs("option", { value: m.organizationId, children: [m.organizationName, " \u00B7 ", m.role.toLowerCase()] }, m.organizationId))) })] })) : (_jsxs("div", { className: styles.orgSingle, children: [_jsx("span", { className: styles.orgName, children: activeMembership?.organizationName ?? '—' }), _jsx("span", { className: styles.orgRole, children: activeMembership?.role ?? '' })] })) }), _jsxs("nav", { className: styles.nav, "aria-label": "Main navigation", children: [renderNav(PRIMARY_NAV), adminEntries.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.navSection, children: "Organization" }), renderNav(ADMIN_NAV)] }))] }), _jsxs("div", { className: styles.sidebarFooter, children: [_jsxs("div", { className: styles.userRow, children: [_jsx(Avatar, { name: user?.name ?? '?', colorIndex: user?.avatarColor ?? 0, size: "md" }), _jsxs("div", { className: styles.userMeta, children: [_jsx("div", { className: styles.userName, children: user?.name }), _jsx("div", { className: styles.userEmail, children: user?.email })] })] }), _jsxs("div", { className: styles.footerActions, children: [_jsxs(Button, { variant: "ghost", size: "sm", onClick: cycleTheme, title: "Change theme", children: [themeIcon[themeMode], " Theme"] }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => void logout(), children: "Sign out" })] })] })] }), _jsxs("div", { className: styles.main, children: [capabilities && !capabilities.execution.isolated && (_jsxs("div", { className: styles.runnerWarning, role: "status", children: [_jsx("strong", { children: "Development runner:" }), _jsxs("span", { children: ["Code runs as a child process on the API host, not in a container. ", ' ', capabilities.execution.note] })] })), _jsx("div", { className: styles.mobileBar, children: _jsx(Button, { variant: "ghost", size: "sm", className: styles.mobileToggle, onClick: () => setSidebarOpen((open) => !open), "aria-expanded": sidebarOpen, children: "\u2630 Menu" }) }), _jsx("div", { className: styles.content, children: _jsx("div", { className: styles.contentInner, children: _jsx(Outlet, {}) }) }, location.pathname)] })] }));
}
