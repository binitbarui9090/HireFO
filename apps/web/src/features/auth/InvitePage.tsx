import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { LoadingBlock } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useAuthStore } from '../../store/auth';
import { AuthLayout } from './AuthLayout';
import styles from './Auth.module.css';

interface InvitationPreview {
  email: string;
  role: 'ADMIN' | 'INTERVIEWER' | 'CANDIDATE';
  organizationName: string;
  interviewTitle: string | null;
  requiresPassword: boolean;
  expiresAt: string;
}

const ROLE_COPY: Record<string, string> = {
  ADMIN: 'Administrator',
  INTERVIEWER: 'Interviewer',
  CANDIDATE: 'Candidate',
};

export function InvitePage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const acceptInvitation = useAuthStore((s) => s.acceptInvitation);

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<InvitationPreview>(`/api/auth/invitations/${token}`, {
          skipRefresh: true,
        });
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError
              ? err.message
              : 'Could not load this invitation. Check the link and try again.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await acceptInvitation({
        token,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(preview?.requiresPassword ? { password } : {}),
      });
      navigate(result.interviewId ? `/interviews/${result.interviewId}/workspace` : '/', {
        replace: true,
      });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not accept the invitation. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <AuthLayout
        title="Invitation unavailable"
        subtitle="This link cannot be used."
        footer={
          <>
            Already have an account? <Link to="/login">Sign in</Link>
          </>
        }
      >
        <div className={styles.formError} role="alert">
          {loadError}
        </div>
      </AuthLayout>
    );
  }

  if (!preview) {
    return (
      <AuthLayout title="Checking your invitation…">
        <LoadingBlock label="Loading invitation" />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={`Join ${preview.organizationName}`}
      subtitle={
        preview.requiresPassword
          ? 'Choose a password to finish setting up your account.'
          : 'You already have a HireFO account. Accept to join this organization.'
      }
      footer={
        <>
          Wrong account? <Link to="/login">Sign in as someone else</Link>
        </>
      }
    >
      <div className={styles.inviteMeta}>
        <div className={styles.inviteRow}>
          <span className={styles.inviteLabel}>Email</span>
          <span className={styles.inviteValue}>{preview.email}</span>
        </div>
        <div className={styles.inviteRow}>
          <span className={styles.inviteLabel}>Role</span>
          <span className={styles.inviteValue}>{ROLE_COPY[preview.role] ?? preview.role}</span>
        </div>
        {preview.interviewTitle && (
          <div className={styles.inviteRow}>
            <span className={styles.inviteLabel}>Interview</span>
            <span className={styles.inviteValue}>{preview.interviewTitle}</span>
          </div>
        )}
        <div className={styles.inviteRow}>
          <span className={styles.inviteLabel}>Link expires</span>
          <span className={styles.inviteValue}>{formatDateTime(preview.expiresAt)}</span>
        </div>
      </div>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {error && (
          <div className={styles.formError} role="alert">
            {error}
          </div>
        )}
        {preview.requiresPassword && (
          <>
            <Input
              label="Your name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              optional
              placeholder={preview.email.split('@')[0]}
            />
            <Input
              label="Choose a password"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              hint="At least 12 characters, with a letter and a number."
            />
          </>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          {preview.interviewTitle ? 'Accept and open interview' : 'Accept invitation'}
        </Button>
      </form>
    </AuthLayout>
  );
}
