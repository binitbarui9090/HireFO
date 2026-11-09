import { useToastStore, type ToastKind } from '../../store/toast';
import styles from './Toaster.module.css';

const marker: Record<ToastKind, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ⓘ',
};

const markerClass: Record<ToastKind, string> = {
  success: styles.markerSuccess!,
  error: styles.markerError!,
  warning: styles.markerWarning!,
  info: styles.markerInfo!,
};

/** Live region so screen readers announce toasts as they arrive. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className={styles.viewport} role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[styles.toast, styles[t.kind]].join(' ')}
          role={t.kind === 'error' ? 'alert' : 'status'}
          aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
        >
          <span className={[styles.marker, markerClass[t.kind]].join(' ')} aria-hidden="true">
            {marker[t.kind]}
          </span>
          <div className={styles.content}>
            <div className={styles.title}>{t.title}</div>
            {t.description && <div className={styles.description}>{t.description}</div>}
          </div>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
