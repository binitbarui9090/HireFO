import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Avatar } from '../ui/Primitives';
import { Button } from '../ui/Button';
import { useAuthStore, useIsStaff } from '../../store/auth';
import { useCapabilitiesStore } from '../../store/capabilities';
import { useThemeStore } from '../../store/theme';
import styles from './AppShell.module.css';

interface NavEntry {
  to: string;
  label: string;
  icon: string;
  staffOnly?: boolean;
  adminOnly?: boolean;
}

const PRIMARY_NAV: NavEntry[] = [
  { to: '/', label: 'Dashboard', icon: '▦' },
  { to: '/interviews', label: 'Interviews', icon: '▤' },
  { to: '/questions', label: 'Question library', icon: '❑', staffOnly: true },
];

const ADMIN_NAV: NavEntry[] = [
  { to: '/settings/team', label: 'Team & invites', icon: '◉', staffOnly: true },
  { to: '/settings/usage', label: 'Copilot usage', icon: '◴', staffOnly: true },
  { to: '/settings/audit', label: 'Audit log', icon: '⎙', adminOnly: true },
];

const themeIcon: Record<string, string> = { dark: '☾', light: '☀', system: '◐' };

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const activeOrgId = useAuthStore((s) => s.activeOrgId);
  const setActiveOrg = useAuthStore((s) => s.setActiveOrg);
  const logout = useAuthStore((s) => s.logout);
  const isStaff = useIsStaff();
  const capabilities = useCapabilitiesStore((s) => s.data);
  const cycleTheme = useThemeStore((s) => s.cycle);
  const themeMode = useThemeStore((s) => s.mode);

  const activeMembership = memberships.find((m) => m.organizationId === activeOrgId);
  const isAdmin = activeMembership?.role === 'ADMIN';

  const visible = (entry: NavEntry): boolean => {
    if (entry.adminOnly) return isAdmin;
    if (entry.staffOnly) return isStaff;
    return true;
  };

  const renderNav = (entries: NavEntry[]): ReactNode =>
    entries.filter(visible).map((entry) => (
      <NavLink
        key={entry.to}
        to={entry.to}
        end={entry.to === '/'}
        className={({ isActive }) =>
          [styles.navItem, isActive ? styles.navItemActive : ''].filter(Boolean).join(' ')
        }
        onClick={() => setSidebarOpen(false)}
      >
        <span className={styles.navIcon} aria-hidden="true">
          {entry.icon}
        </span>
        {entry.label}
      </NavLink>
    ));

  const adminEntries = ADMIN_NAV.filter(visible);

  return (
    <div className={styles.shell}>
      <aside
        className={[styles.sidebar, sidebarOpen ? styles.sidebarOpen : ''].filter(Boolean).join(' ')}
      >
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            H
          </span>
          <span className={styles.brandName}>HireFO</span>
        </div>

        <div className={styles.orgSwitcher}>
          {memberships.length > 1 ? (
            <>
              <label className="srOnly" htmlFor="org-switcher">
                Active organization
              </label>
              <select
                id="org-switcher"
                className={styles.orgSelect}
                value={activeOrgId ?? ''}
                onChange={(event) => setActiveOrg(event.target.value)}
              >
                {memberships.map((m) => (
                  <option key={m.organizationId} value={m.organizationId}>
                    {m.organizationName} · {m.role.toLowerCase()}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <div className={styles.orgSingle}>
              <span className={styles.orgName}>{activeMembership?.organizationName ?? '—'}</span>
              <span className={styles.orgRole}>{activeMembership?.role ?? ''}</span>
            </div>
          )}
        </div>

        <nav className={styles.nav} aria-label="Main navigation">
          {renderNav(PRIMARY_NAV)}
          {adminEntries.length > 0 && (
            <>
              <div className={styles.navSection}>Organization</div>
              {renderNav(ADMIN_NAV)}
            </>
          )}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.userRow}>
            <Avatar name={user?.name ?? '?'} colorIndex={user?.avatarColor ?? 0} size="md" />
            <div className={styles.userMeta}>
              <div className={styles.userName}>{user?.name}</div>
              <div className={styles.userEmail}>{user?.email}</div>
            </div>
          </div>
          <div className={styles.footerActions}>
            <Button variant="ghost" size="sm" onClick={cycleTheme} title="Change theme">
              {themeIcon[themeMode]} Theme
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        {capabilities && !capabilities.execution.isolated && (
          <div className={styles.runnerWarning} role="status">
            <strong>Development runner:</strong>
            <span>
              Code runs as a child process on the API host, not in a container. {' '}
              {capabilities.execution.note}
            </span>
          </div>
        )}
        <div className={styles.mobileBar}>
          <Button
            variant="ghost"
            size="sm"
            className={styles.mobileToggle}
            onClick={() => setSidebarOpen((open) => !open)}
            aria-expanded={sidebarOpen}
          >
            ☰ Menu
          </Button>
        </div>
        <div className={styles.content} key={location.pathname}>
          <div className={styles.contentInner}>
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
