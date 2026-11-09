import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import styles from './PageHeader.module.css';
export function PageHeader({ title, description, actions, breadcrumbs, }) {
    return (_jsxs("div", { className: styles.header, children: [_jsxs("div", { className: styles.group, children: [breadcrumbs && breadcrumbs.length > 0 && (_jsx("nav", { className: styles.breadcrumb, "aria-label": "Breadcrumb", children: breadcrumbs.map((crumb, index) => (_jsxs("span", { children: [crumb.to ? _jsx(Link, { to: crumb.to, children: crumb.label }) : crumb.label, index < breadcrumbs.length - 1 && _jsx("span", { "aria-hidden": "true", children: " / " })] }, `${crumb.label}-${index}`))) })), _jsx("h1", { className: styles.title, children: title }), description && _jsx("p", { className: styles.description, children: description })] }), actions && _jsx("div", { className: styles.actions, children: actions })] }));
}
