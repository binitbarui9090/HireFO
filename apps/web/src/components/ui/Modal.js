import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';
/**
 * Accessible dialog: focus moves in on open and returns to the trigger on close,
 * Tab is trapped inside, Escape dismisses, and the page behind cannot scroll.
 */
export function Modal({ open, onClose, title, description, size = 'md', footer, children, dismissOnBackdrop = true, }) {
    const panelRef = useRef(null);
    const previouslyFocused = useRef(null);
    const focusables = useCallback(() => {
        if (!panelRef.current)
            return [];
        return Array.from(panelRef.current.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
    }, []);
    useEffect(() => {
        if (!open)
            return;
        previouslyFocused.current = document.activeElement;
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const timer = setTimeout(() => {
            const first = focusables()[0] ?? panelRef.current;
            first?.focus();
        }, 0);
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
                return;
            }
            if (event.key !== 'Tab')
                return;
            const items = focusables();
            if (items.length === 0)
                return;
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            }
            else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('keydown', onKeyDown, true);
            document.body.style.overflow = overflow;
            previouslyFocused.current?.focus();
        };
    }, [open, onClose, focusables]);
    if (!open)
        return null;
    return createPortal(_jsx("div", { className: styles.backdrop, onMouseDown: (event) => {
            if (dismissOnBackdrop && event.target === event.currentTarget)
                onClose();
        }, children: _jsxs("div", { ref: panelRef, className: [styles.panel, styles[size]].join(' '), role: "dialog", "aria-modal": "true", "aria-labelledby": "modal-title", tabIndex: -1, children: [_jsxs("div", { className: styles.header, children: [_jsxs("div", { children: [_jsx("div", { className: styles.title, id: "modal-title", children: title }), description && _jsx("div", { className: styles.description, children: description })] }), _jsx("button", { type: "button", className: styles.close, onClick: onClose, "aria-label": "Close dialog", children: "\u2715" })] }), _jsx("div", { className: styles.body, children: children }), footer && _jsx("div", { className: styles.footer, children: footer })] }) }), document.body);
}
