import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useToastStore } from '../../store/toast';
import styles from './Toaster.module.css';
const marker = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ⓘ',
};
const markerClass = {
    success: styles.markerSuccess,
    error: styles.markerError,
    warning: styles.markerWarning,
    info: styles.markerInfo,
};
/** Live region so screen readers announce toasts as they arrive. */
export function Toaster() {
    const toasts = useToastStore((s) => s.toasts);
    const dismiss = useToastStore((s) => s.dismiss);
    return (_jsx("div", { className: styles.viewport, role: "region", "aria-label": "Notifications", children: toasts.map((t) => (_jsxs("div", { className: [styles.toast, styles[t.kind]].join(' '), role: t.kind === 'error' ? 'alert' : 'status', "aria-live": t.kind === 'error' ? 'assertive' : 'polite', children: [_jsx("span", { className: [styles.marker, markerClass[t.kind]].join(' '), "aria-hidden": "true", children: marker[t.kind] }), _jsxs("div", { className: styles.content, children: [_jsx("div", { className: styles.title, children: t.title }), t.description && _jsx("div", { className: styles.description, children: t.description })] }), _jsx("button", { type: "button", className: styles.dismiss, onClick: () => dismiss(t.id), "aria-label": "Dismiss notification", children: "\u2715" })] }, t.id))) }));
}
