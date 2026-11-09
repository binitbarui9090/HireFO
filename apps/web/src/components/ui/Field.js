import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef, useId, } from 'react';
import styles from './Field.module.css';
/** Label + hint + error scaffolding shared by every form control. */
export function FieldShell({ label, hint, error, required, optional, htmlFor, children, }) {
    return (_jsxs("div", { className: styles.field, children: [(label || optional) && (_jsxs("div", { className: styles.labelRow, children: [label && (_jsxs("label", { className: styles.label, htmlFor: htmlFor, children: [label, required && (_jsx("span", { className: styles.required, "aria-hidden": "true", children: "*" }))] })), optional && _jsx("span", { className: styles.optional, children: "optional" })] })), children, hint && !error && _jsx("p", { className: styles.hint, children: hint }), error && (_jsx("p", { className: styles.error, role: "alert", children: error }))] }));
}
export const Input = forwardRef(function Input({ label, hint, error, optional, mono, id, required, className, ...rest }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (_jsx(FieldShell, { ...(label !== undefined ? { label } : {}), ...(hint !== undefined ? { hint } : {}), ...(error !== undefined ? { error } : {}), ...(required !== undefined ? { required } : {}), ...(optional !== undefined ? { optional } : {}), htmlFor: inputId, children: _jsx("input", { ref: ref, id: inputId, required: required, "aria-invalid": error ? true : undefined, className: [styles.control, mono ? styles.mono : '', error ? styles.invalid : '', className ?? '']
                .filter(Boolean)
                .join(' '), ...rest }) }));
});
export const Textarea = forwardRef(function Textarea({ label, hint, error, optional, mono, id, required, className, ...rest }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (_jsx(FieldShell, { ...(label !== undefined ? { label } : {}), ...(hint !== undefined ? { hint } : {}), ...(error !== undefined ? { error } : {}), ...(required !== undefined ? { required } : {}), ...(optional !== undefined ? { optional } : {}), htmlFor: inputId, children: _jsx("textarea", { ref: ref, id: inputId, required: required, "aria-invalid": error ? true : undefined, className: [styles.textarea, mono ? styles.mono : '', error ? styles.invalid : '', className ?? '']
                .filter(Boolean)
                .join(' '), ...rest }) }));
});
export const Select = forwardRef(function Select({ label, hint, error, optional, id, required, className, children, ...rest }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (_jsx(FieldShell, { ...(label !== undefined ? { label } : {}), ...(hint !== undefined ? { hint } : {}), ...(error !== undefined ? { error } : {}), ...(required !== undefined ? { required } : {}), ...(optional !== undefined ? { optional } : {}), htmlFor: inputId, children: _jsx("select", { ref: ref, id: inputId, required: required, "aria-invalid": error ? true : undefined, className: [styles.select, error ? styles.invalid : '', className ?? ''].filter(Boolean).join(' '), ...rest, children: children }) }));
});
export function Checkbox({ label, hint, id, className, ...rest }) {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (_jsxs("label", { className: styles.checkboxRow, htmlFor: inputId, children: [_jsx("input", { type: "checkbox", id: inputId, className: [styles.checkbox, className ?? ''].filter(Boolean).join(' '), ...rest }), _jsxs("span", { className: styles.checkboxLabel, children: [label, hint && _jsx("span", { className: styles.checkboxHint, children: hint })] })] }));
}
