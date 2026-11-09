import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { ApiError } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { AuthLayout } from './AuthLayout';
import styles from './Auth.module.css';
/** Password policy mirrors the server's zod schema in @hirefo/shared. */
function passwordProblem(value) {
    if (value.length < 12)
        return 'Use at least 12 characters.';
    if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
        return 'Include at least one letter and one number.';
    }
    return null;
}
export function RegisterPage() {
    const navigate = useNavigate();
    const register = useAuthStore((s) => s.register);
    const [form, setForm] = useState({
        name: '',
        email: '',
        password: '',
        organizationName: '',
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [fieldErrors, setFieldErrors] = useState({});
    const [touchedPassword, setTouchedPassword] = useState(false);
    const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
    const localPasswordError = touchedPassword ? passwordProblem(form.password) : null;
    const onSubmit = async (event) => {
        event.preventDefault();
        const problem = passwordProblem(form.password);
        if (problem) {
            setTouchedPassword(true);
            return;
        }
        setSubmitting(true);
        setError(null);
        setFieldErrors({});
        try {
            await register(form);
            navigate('/', { replace: true });
        }
        catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
                setFieldErrors(err.fieldErrors ?? {});
            }
            else {
                setError('Could not create the account. Please check your connection.');
            }
        }
        finally {
            setSubmitting(false);
        }
    };
    const serverError = (field) => fieldErrors[field]?.[0] ?? null;
    return (_jsx(AuthLayout, { title: "Create your organization", subtitle: "You will be its first admin, and can invite interviewers and candidates straight away.", footer: _jsxs(_Fragment, { children: ["Already have an account? ", _jsx(Link, { to: "/login", children: "Sign in" })] }), children: _jsxs("form", { className: styles.form, onSubmit: onSubmit, noValidate: true, children: [error && (_jsx("div", { className: styles.formError, role: "alert", children: error })), _jsx(Input, { label: "Organization name", name: "organizationName", required: true, value: form.organizationName, onChange: update('organizationName'), error: serverError('organizationName'), placeholder: "Acme Engineering" }), _jsx(Input, { label: "Your name", name: "name", autoComplete: "name", required: true, value: form.name, onChange: update('name'), error: serverError('name') }), _jsx(Input, { label: "Work email", type: "email", name: "email", autoComplete: "email", required: true, value: form.email, onChange: update('email'), error: serverError('email'), placeholder: "you@company.com" }), _jsx(Input, { label: "Password", type: "password", name: "password", autoComplete: "new-password", required: true, value: form.password, onChange: update('password'), onBlur: () => setTouchedPassword(true), error: localPasswordError ?? serverError('password'), hint: "At least 12 characters, with a letter and a number." }), _jsx(Button, { type: "submit", variant: "primary", size: "lg", block: true, loading: submitting, children: "Create organization" })] }) }));
}
