import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import styles from './Button.module.css';
export const Button = forwardRef(function Button({ variant = 'secondary', size = 'md', loading = false, block = false, iconOnly = false, leadingIcon, disabled, className, children, ...rest }, ref) {
    const classes = [
        styles.button,
        styles[variant],
        styles[size],
        block ? styles.block : '',
        iconOnly ? styles.iconOnly : '',
        className ?? '',
    ]
        .filter(Boolean)
        .join(' ');
    return (_jsxs("button", { ref: ref, className: classes, disabled: disabled || loading, "aria-busy": loading || undefined, ...rest, children: [loading ? _jsx("span", { className: styles.spinner, "aria-hidden": "true" }) : leadingIcon, children] }));
});
/**
 * A router link styled as a button. Keeps navigation semantics (right-click,
 * middle-click, keyboard) instead of nesting an anchor inside a <button>.
 */
export function LinkButton({ to, variant = 'secondary', size = 'md', block = false, leadingIcon, children, className, title, }) {
    const classes = [
        styles.button,
        styles[variant],
        styles[size],
        block ? styles.block : '',
        className ?? '',
    ]
        .filter(Boolean)
        .join(' ');
    return (_jsxs(Link, { to: to, className: classes, title: title, children: [leadingIcon, children] }));
}
