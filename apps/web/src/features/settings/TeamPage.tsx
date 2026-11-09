import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import {
  Avatar,
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  LoadingBlock,
} from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatRelative, titleCase } from '../../lib/format';
import { useActiveRole, useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import styles from './Settings.module.css';
import type { MemberDto } from '../interviews/types';

interface InvitationDto {
  id: string;
  email: string;
  role: string;
  interview: { id: string; title: string } | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
}

interface InvitationResult {
  email: string;
  role: string;
  url: string;
  expiresAt: string;
  note: string;
}

const statusTone: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  ACCEPTED: 'success',
  PENDING: 'warning',
  EXPIRED: 'neutral',
  REVOKED: 'danger',
};

export function TeamPage() {
  const role = useActiveRole();
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = role === 'ADMIN';

  const [members, setMembers] = useState<MemberDto[]>([]);
  const [invitations, setInvitations] = useState<InvitationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('CANDIDATE');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<InvitationResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [memberData, invitationData] = await Promise.all([
        api.get<{ items: MemberDto[] }>('/api/org/members'),
        api.get<{ items: InvitationDto[] }>('/api/org/invitations'),
      ]);
      setMembers(memberData.items);
      setInvitations(invitationData.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the team.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = async (userId: string, nextRole: string) => {
    setBusy(userId);
    try {
      await api.patch(`/api/org/members/${userId}`, { role: nextRole });
      toast.success('Role updated');
      await load();
    } catch (err) {
      toast.error('Could not change the role', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const suspend = async (userId: string) => {
    setBusy(userId);
    try {
      await api.delete(`/api/org/members/${userId}`);
      toast.success('Member suspended', 'Their interviews and audit history are kept.');
      await load();
    } catch (err) {
      toast.error('Could not suspend', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (invitationId: string) => {
    setBusy(invitationId);
    try {
      await api.post(`/api/org/invitations/${invitationId}/revoke`);
      toast.success('Invitation revoked');
      await load();
    } catch (err) {
      toast.error('Could not revoke', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const createInvite = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInviteResult(null);
    try {
      const result = await api.post<InvitationResult>('/api/org/invitations', {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInviteResult(result);
      await load();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : 'Could not create the invitation.');
    } finally {
      setInviting(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading team" />;

  return (
    <>
      <PageHeader
        title="Team & invites"
        description="Members of this organization and the invitation links you have generated. Data never crosses organization boundaries."
        actions={
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setInviteResult(null);
              setInviteError(null);
              setInviteEmail('');
              setInviteOpen(true);
            }}
          >
            Invite someone
          </Button>
        }
      />

      {error && (
        <Callout tone="danger" title="Could not load the team">
          {error}
        </Callout>
      )}

      <div className={styles.sections}>
        <Card>
          <CardHeader title="Members" subtitle={`${members.length} total`} />
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th>Joined</th>
                  {isAdmin && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.membershipId}>
                    <td>
                      <div className={styles.userCell}>
                        <Avatar name={member.name} colorIndex={member.avatarColor} size="md" />
                        <div>
                          <div className={styles.userName}>
                            {member.name}
                            {member.userId === currentUser?.id && ' (you)'}
                          </div>
                          <div className={styles.userEmail}>{member.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {isAdmin && member.userId !== currentUser?.id ? (
                        <select
                          className={styles.roleSelect}
                          value={member.role}
                          disabled={busy === member.userId}
                          onChange={(event) => void changeRole(member.userId, event.target.value)}
                          aria-label={`Role for ${member.name}`}
                        >
                          <option value="ADMIN">Admin</option>
                          <option value="INTERVIEWER">Interviewer</option>
                          <option value="CANDIDATE">Candidate</option>
                        </select>
                      ) : (
                        <Badge tone={member.role === 'ADMIN' ? 'accent' : 'neutral'}>
                          {titleCase(member.role)}
                        </Badge>
                      )}
                    </td>
                    <td>
                      <Badge
                        tone={
                          member.status === 'ACTIVE'
                            ? 'success'
                            : member.status === 'SUSPENDED'
                              ? 'danger'
                              : 'warning'
                        }
                        dot
                      >
                        {titleCase(member.status)}
                      </Badge>
                    </td>
                    <td className={styles.muted}>
                      {member.lastLoginAt ? formatRelative(member.lastLoginAt) : 'never'}
                    </td>
                    <td className={styles.muted}>{formatRelative(member.joinedAt)}</td>
                    {isAdmin && (
                      <td className={styles.actionsCell}>
                        {member.userId !== currentUser?.id && member.status === 'ACTIVE' && (
                          <Button
                            variant="dangerGhost"
                            size="sm"
                            loading={busy === member.userId}
                            onClick={() => void suspend(member.userId)}
                          >
                            Suspend
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Invitations"
            subtitle="Links are shown once at creation and stored only as a hash"
          />
          {invitations.length > 0 ? (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Interview</th>
                    <th>Status</th>
                    <th>Expires</th>
                    <th>Invited by</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((invitation) => (
                    <tr key={invitation.id}>
                      <td className={styles.userEmail}>{invitation.email}</td>
                      <td>
                        <Badge tone="neutral">{titleCase(invitation.role)}</Badge>
                      </td>
                      <td className={styles.muted}>{invitation.interview?.title ?? '—'}</td>
                      <td>
                        <Badge tone={statusTone[invitation.status] ?? 'neutral'} dot>
                          {titleCase(invitation.status)}
                        </Badge>
                      </td>
                      <td className={styles.muted}>{formatRelative(invitation.expiresAt)}</td>
                      <td className={styles.muted}>{invitation.createdBy.name}</td>
                      <td className={styles.actionsCell}>
                        {invitation.status === 'PENDING' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busy === invitation.id}
                            onClick={() => void revoke(invitation.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon="◉"
              title="No invitations yet"
              body="Invite an interviewer or a candidate; HireFO generates a one-time link for you to send."
            />
          )}
        </Card>
      </div>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite someone"
        description="No email is sent — HireFO has no mail transport configured. Copy the link and send it yourself."
        footer={
          inviteResult ? (
            <Button variant="primary" onClick={() => setInviteOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={inviting}
                disabled={!inviteEmail.trim()}
                onClick={() => void createInvite()}
              >
                Create link
              </Button>
            </>
          )
        }
      >
        {inviteResult ? (
          <div className={styles.inviteResult}>
            <Callout tone="warning" title="Copy this link now">
              {inviteResult.note}
            </Callout>
            <div className={styles.inviteLink}>
              <input
                className={styles.inviteLinkInput}
                readOnly
                value={inviteResult.url}
                onFocus={(event) => event.target.select()}
                aria-label="Invitation link"
              />
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(inviteResult.url)
                    .then(() => toast.success('Link copied'))
                    .catch(() => toast.warning('Could not copy', 'Select the link and copy it.'));
                }}
              >
                Copy
              </Button>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              For {inviteResult.email} as {titleCase(inviteResult.role)}. Expires{' '}
              {formatDateTime(inviteResult.expiresAt)}.
            </p>
          </div>
        ) : (
          <form
            onSubmit={(event) => void createInvite(event)}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
          >
            {inviteError && (
              <Callout tone="danger" title="Could not create the link">
                {inviteError}
              </Callout>
            )}
            <Input
              label="Email"
              type="email"
              required
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="person@example.com"
            />
            <Select
              label="Role"
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value)}
              hint={
                isAdmin
                  ? 'Admins manage the team. Interviewers run sessions. Candidates see only their own interviews.'
                  : 'Only admins can invite interviewers or admins.'
              }
            >
              <option value="CANDIDATE">Candidate</option>
              {isAdmin && <option value="INTERVIEWER">Interviewer</option>}
              {isAdmin && <option value="ADMIN">Admin</option>}
            </Select>
          </form>
        )}
      </Modal>
    </>
  );
}
