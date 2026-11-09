import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { ApiError } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { AuthLayout } from './AuthLayout';
import styles from './Auth.module.css';
export function LoginPage() {
    const navigate = useNavigate();
    const login = useAuthStore((s) => s.login);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const onSubmit = async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            await login(email, password);
            navigate('/', { replace: true });
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not sign in. Please check your connection.');
        }
        finally {
            setSubmitting(false);
        }
    };
    return (_jsx(AuthLayout, { title: "Sign in", subtitle: "Use the account your organization set up for you.", footer: _jsxs(_Fragment, { children: ["No organization yet? ", _jsx(Link, { to: "/register", children: "Create one" })] }), children: _jsxs("form", { className: styles.form, onSubmit: onSubmit, noValidate: true, children: [error && (_jsx("div", { className: styles.formError, role: "alert", children: error })), _jsx(Input, { label: "Work email", type: "email", name: "email", autoComplete: "email", required: true, value: email, onChange: (event) => setEmail(event.target.value), placeholder: "you@company.com" }), _jsx(Input, { label: "Password", type: "password", name: "password", autoComplete: "current-password", required: true, value: password, onChange: (event) => setPassword(event.target.value) }), _jsx(Button, { type: "submit", variant: "primary", size: "lg", block: true, loading: submitting, children: "Sign in" })] }) }));
}
