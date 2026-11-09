import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCapabilitiesStore } from '../../store/capabilities';
import styles from './Auth.module.css';
const FEATURES = [
    {
        title: 'Collaborative editor',
        body: 'Monaco with live cursors, shared problem statement and server-authoritative sync, so both sides always see the same buffer.',
    },
    {
        title: 'Sandboxed execution',
        body: 'Every run happens in a single-use container with no network, a read-only root filesystem and capped CPU, memory and process count.',
    },
    {
        title: 'Interviewer copilot',
        body: 'Edge cases, follow-up questions and draft notes — labelled as observation or assumption. It never scores or decides anything.',
    },
];
/** Shared two-column frame for sign-in, sign-up and invitation acceptance. */
export function AuthLayout({ title, subtitle, children, footer, }) {
    const capabilities = useCapabilitiesStore((s) => s.data);
    return (_jsxs("div", { className: styles.page, children: [_jsx("div", { className: styles.panel, children: _jsxs("div", { className: styles.inner, children: [_jsxs("div", { className: styles.brand, children: [_jsx("span", { className: styles.brandMark, "aria-hidden": "true", children: "H" }), _jsx("span", { className: styles.brandName, children: "HireFO" })] }), _jsx("h1", { className: styles.title, children: title }), subtitle && _jsx("p", { className: styles.subtitle, children: subtitle }), children, footer && _jsx("div", { className: styles.switcher, children: footer })] }) }), _jsx("div", { className: styles.aside, children: _jsxs("div", { className: styles.asideInner, children: [_jsx("h2", { className: styles.asideTitle, children: "Technical interviews, run properly." }), _jsx("ul", { className: styles.featureList, children: FEATURES.map((feature) => (_jsxs("li", { className: styles.feature, children: [_jsx("span", { className: styles.featureMark, "aria-hidden": "true", children: "\u25C6" }), _jsxs("div", { children: [_jsx("span", { className: styles.featureTitle, children: feature.title }), _jsx("span", { className: styles.featureBody, children: feature.body })] })] }, feature.title))) }), capabilities && (_jsxs("p", { className: styles.featureBody, style: { marginTop: 'var(--space-6)' }, children: ["This instance runs the", ' ', _jsx("strong", { children: capabilities.execution.isolated ? 'Docker' : 'local subprocess' }), ' ', "execution runner, and the copilot is", ' ', _jsx("strong", { children: capabilities.ai.enabled ? `enabled (${capabilities.ai.provider})` : 'disabled' }), "."] }))] }) })] }));
}
