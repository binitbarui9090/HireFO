import type { HTMLAttributes, ReactNode } from 'react';
import { initials } from '../../lib/format';
import styles from './Primitives.module.css';

/* ---------------------------------- Card --------------------------------- */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Applies uniform padding. Omit when using CardHeader/CardBody. */
  padded?: boolean;
}

export function Card({ padded = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={[styles.card, padded ? styles.cardPad : '', className ?? ''].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.cardHeader}>
      <div>
        <div className={styles.cardTitle}>{title}</div>
        {subtitle && <div className={styles.cardSubtitle}>{subtitle}</div>}
      </div>
      {actions}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[styles.cardBody, className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}

/* --------------------------------- Badge --------------------------------- */

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning' | 'info';

const badgeToneClass: Record<BadgeTone, string> = {
  neutral: styles.badgeNeutral!,
  accent: styles.badgeAccent!,
  success: styles.badgeSuccess!,
  danger: styles.badgeDanger!,
  warning: styles.badgeWarning!,
  info: styles.badgeInfo!,
};

export function Badge({
  tone = 'neutral',
  dot = false,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={[styles.badge, badgeToneClass[tone]].join(' ')}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Status -> tone mapping, shared by every place an interview status is shown. */
export const interviewStatusTone: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  IN_PROGRESS: 'accent',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

export const difficultyTone: Record<string, BadgeTone> = {
  EASY: 'success',
  MEDIUM: 'warning',
  HARD: 'danger',
};

export const executionStatusTone: Record<string, BadgeTone> = {
  QUEUED: 'neutral',
  RUNNING: 'accent',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  TIMEOUT: 'warning',
  ERROR: 'danger',
  CANCELLED: 'neutral',
};

/* --------------------------------- Avatar -------------------------------- */

export function Avatar({
  name,
  colorIndex = 0,
  size = 'md',
  ring = false,
  title,
}: {
  name: string;
  colorIndex?: number;
  size?: 'sm' | 'md' | 'lg';
  ring?: boolean;
  title?: string;
}) {
  const sizeClass = size === 'sm' ? styles.avatarSm : size === 'lg' ? styles.avatarLg : styles.avatarMd;
  return (
    <span
      className={[styles.avatar, sizeClass, ring ? styles.avatarRing : ''].filter(Boolean).join(' ')}
      style={{ background: `var(--presence-${colorIndex % 6})` }}
      title={title ?? name}
      aria-hidden={title ? undefined : true}
    >
      {initials(name)}
    </span>
  );
}

/* -------------------------------- Spinner -------------------------------- */

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className={styles.spinner}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className={styles.spinnerCenter}>
      <Spinner size={22} />
      <span>{label}</span>
    </div>
  );
}

/* ------------------------------ EmptyState ------------------------------- */

export function EmptyState({
  icon,
  title,
  body,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      {icon && <div className={styles.emptyIcon}>{icon}</div>}
      <div className={styles.emptyTitle}>{title}</div>
      {body && <div className={styles.emptyBody}>{body}</div>}
      {actions && <div className={styles.emptyActions}>{actions}</div>}
    </div>
  );
}

/* -------------------------------- Callout -------------------------------- */

const calloutToneClass: Record<string, string> = {
  info: styles.calloutInfo!,
  warning: styles.calloutWarning!,
  danger: styles.calloutDanger!,
  neutral: styles.calloutNeutral!,
};

const calloutMarker: Record<string, string> = {
  info: 'ⓘ',
  warning: '⚠',
  danger: '⚠',
  neutral: '•',
};

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'neutral';
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={[styles.callout, calloutToneClass[tone]!].join(' ')}>
      <span className={styles.calloutMarker} aria-hidden="true">
        {calloutMarker[tone]}
      </span>
      <div>
        {title && <strong className={styles.calloutTitle}>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------- Tabs --------------------------------- */

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          className={[styles.tab, item.id === value ? styles.tabActive : ''].filter(Boolean).join(' ')}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && <span className={styles.tabCount}>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------- Stat --------------------------------- */

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </div>
  );
}

/* ---------------------------------- Kbd ---------------------------------- */

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}
