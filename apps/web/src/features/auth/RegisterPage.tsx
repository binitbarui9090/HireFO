import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { ApiError } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { AuthLayout } from './AuthLayout';
import styles from './Auth.module.css';

/** Password policy mirrors the server's zod schema in @hirefo/shared. */
function passwordProblem(value: string): string | null {
  if (value.length < 12) return 'Use at least 12 characters.';
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
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [touchedPassword, setTouchedPassword] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const localPasswordError = touchedPassword ? passwordProblem(form.password) : null;

  const onSubmit = async (event: React.FormEvent) => {
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
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors ?? {});
      } else {
        setError('Could not create the account. Please check your connection.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const serverError = (field: string): string | null => fieldErrors[field]?.[0] ?? null;

  return (
    <AuthLayout
      title="Create your organization"
      subtitle="You will be its first admin, and can invite interviewers and candidates straight away."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {error && (
          <div className={styles.formError} role="alert">
            {error}
          </div>
        )}
        <Input
          label="Organization name"
          name="organizationName"
          required
          value={form.organizationName}
          onChange={update('organizationName')}
          error={serverError('organizationName')}
          placeholder="Acme Engineering"
        />
        <Input
          label="Your name"
          name="name"
          autoComplete="name"
          required
          value={form.name}
          onChange={update('name')}
          error={serverError('name')}
        />
        <Input
          label="Work email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={update('email')}
          error={serverError('email')}
          placeholder="you@company.com"
        />
        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={form.password}
          onChange={update('password')}
          onBlur={() => setTouchedPassword(true)}
          error={localPasswordError ?? serverError('password')}
          hint="At least 12 characters, with a letter and a number."
        />
        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          Create organization
        </Button>
      </form>
    </AuthLayout>
  );
}
