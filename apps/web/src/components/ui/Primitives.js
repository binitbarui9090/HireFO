import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { initials } from '../../lib/format';
import styles from './Primitives.module.css';
export function Card({ padded = false, className, children, ...rest }) {
    return (_jsx("div", { className: [styles.card, padded ? styles.cardPad : '', className ?? ''].filter(Boolean).join(' '), ...rest, children: children }));
}
export function CardHeader({ title, subtitle, actions, }) {
    return (_jsxs("div", { className: styles.cardHeader, children: [_jsxs("div", { children: [_jsx("div", { className: styles.cardTitle, children: title }), subtitle && _jsx("div", { className: styles.cardSubtitle, children: subtitle })] }), actions] }));
}
export function CardBody({ className, children, ...rest }) {
    return (_jsx("div", { className: [styles.cardBody, className ?? ''].filter(Boolean).join(' '), ...rest, children: children }));
}
const badgeToneClass = {
    neutral: styles.badgeNeutral,
    accent: styles.badgeAccent,
    success: styles.badgeSuccess,
    danger: styles.badgeDanger,
    warning: styles.badgeWarning,
    info: styles.badgeInfo,
};
export function Badge({ tone = 'neutral', dot = false, children, }) {
    return (_jsxs("span", { className: [styles.badge, badgeToneClass[tone]].join(' '), children: [dot && _jsx("span", { className: styles.dot, "aria-hidden": "true" }), children] }));
}
/** Status -> tone mapping, shared by every place an interview status is shown. */
export const interviewStatusTone = {
    DRAFT: 'neutral',
    SCHEDULED: 'info',
    IN_PROGRESS: 'accent',
    COMPLETED: 'success',
    CANCELLED: 'danger',
};
export const difficultyTone = {
    EASY: 'success',
    MEDIUM: 'warning',
    HARD: 'danger',
};
export const executionStatusTone = {
    QUEUED: 'neutral',
    RUNNING: 'accent',
    SUCCEEDED: 'success',
    FAILED: 'danger',
    TIMEOUT: 'warning',
    ERROR: 'danger',
    CANCELLED: 'neutral',
};
/* --------------------------------- Avatar -------------------------------- */
export function Avatar({ name, colorIndex = 0, size = 'md', ring = false, title, }) {
    const sizeClass = size === 'sm' ? styles.avatarSm : size === 'lg' ? styles.avatarLg : styles.avatarMd;
    return (_jsx("span", { className: [styles.avatar, sizeClass, ring ? styles.avatarRing : ''].filter(Boolean).join(' '), style: { background: `var(--presence-${colorIndex % 6})` }, title: title ?? name, "aria-hidden": title ? undefined : true, children: initials(name) }));
}
/* -------------------------------- Spinner -------------------------------- */
export function Spinner({ size = 16 }) {
    return (_jsx("span", { className: styles.spinner, style: { width: size, height: size }, role: "status", "aria-label": "Loading" }));
}
export function LoadingBlock({ label = 'Loading…' }) {
    return (_jsxs("div", { className: styles.spinnerCenter, children: [_jsx(Spinner, { size: 22 }), _jsx("span", { children: label })] }));
}
/* ------------------------------ EmptyState ------------------------------- */
export function EmptyState({ icon, title, body, actions, }) {
    return (_jsxs("div", { className: styles.empty, children: [icon && _jsx("div", { className: styles.emptyIcon, children: icon }), _jsx("div", { className: styles.emptyTitle, children: title }), body && _jsx("div", { className: styles.emptyBody, children: body }), actions && _jsx("div", { className: styles.emptyActions, children: actions })] }));
}
/* -------------------------------- Callout -------------------------------- */
const calloutToneClass = {
    info: styles.calloutInfo,
    warning: styles.calloutWarning,
    danger: styles.calloutDanger,
    neutral: styles.calloutNeutral,
};
const calloutMarker = {
    info: 'ⓘ',
    warning: '⚠',
    danger: '⚠',
    neutral: '•',
};
export function Callout({ tone = 'info', title, children, }) {
    return (_jsxs("div", { className: [styles.callout, calloutToneClass[tone]].join(' '), children: [_jsx("span", { className: styles.calloutMarker, "aria-hidden": "true", children: calloutMarker[tone] }), _jsxs("div", { children: [title && _jsx("strong", { className: styles.calloutTitle, children: title }), children] })] }));
}
export function Tabs({ items, value, onChange, ariaLabel, }) {
    return (_jsx("div", { className: styles.tabs, role: "tablist", "aria-label": ariaLabel, children: items.map((item) => (_jsxs("button", { type: "button", role: "tab", "aria-selected": item.id === value, className: [styles.tab, item.id === value ? styles.tabActive : ''].filter(Boolean).join(' '), onClick: () => onChange(item.id), children: [item.label, item.count !== undefined && _jsx("span", { className: styles.tabCount, children: item.count })] }, item.id))) }));
}
/* ---------------------------------- Stat --------------------------------- */
export function Stat({ label, value, hint, }) {
    return (_jsxs("div", { className: styles.stat, children: [_jsx("span", { className: styles.statLabel, children: label }), _jsx("span", { className: styles.statValue, children: value }), hint && _jsx("span", { className: styles.statHint, children: hint })] }));
}
/* ---------------------------------- Kbd ---------------------------------- */
export function Kbd({ children }) {
    return _jsx("kbd", { className: styles.kbd, children: children });
}
