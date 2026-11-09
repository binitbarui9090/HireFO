import type { ReactNode } from 'react';
import { useCapabilitiesStore } from '../../store/capabilities';
import styles from './Auth.module.css';

interface Feature {
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    title: 'Collaborative editor',
    body: 'Monaco with live cursors, shared problem statement and server-authoritative sync, so both sides always see the same buffer.',
  },
  {
    title: 'Sandboxed execution',
    body: 'Every run happens in a single-use container with no network, a read-only root filesystem and capped CPU, memory and process count.',
  },
  {
    title: 'Interviewer copilot',
    body: 'Edge cases, follow-up questions and draft notes — labelled as observation or assumption. It never scores or decides anything.',
  },
];

/** Shared two-column frame for sign-in, sign-up and invitation acceptance. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const capabilities = useCapabilitiesStore((s) => s.data);

  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.inner}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              H
            </span>
            <span className={styles.brandName}>HireFO</span>
          </div>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          {children}
          {footer && <div className={styles.switcher}>{footer}</div>}
        </div>
      </div>

      <div className={styles.aside}>
        <div className={styles.asideInner}>
          <h2 className={styles.asideTitle}>Technical interviews, run properly.</h2>
          <ul className={styles.featureList}>
            {FEATURES.map((feature) => (
              <li key={feature.title} className={styles.feature}>
                <span className={styles.featureMark} aria-hidden="true">
                  ◆
                </span>
                <div>
                  <span className={styles.featureTitle}>{feature.title}</span>
                  <span className={styles.featureBody}>{feature.body}</span>
                </div>
              </li>
            ))}
          </ul>
          {capabilities && (
            <p className={styles.featureBody} style={{ marginTop: 'var(--space-6)' }}>
              This instance runs the{' '}
              <strong>{capabilities.execution.isolated ? 'Docker' : 'local subprocess'}</strong>{' '}
              execution runner, and the copilot is{' '}
              <strong>{capabilities.ai.enabled ? `enabled (${capabilities.ai.provider})` : 'disabled'}</strong>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
