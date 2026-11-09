import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import { useThemeStore } from '../../store/theme';
import styles from './Topbar.module.css';

const themeIcon: Record<string, string> = { dark: '☾', light: '☀', system: '◐' };
const themeLabel: Record<string, string> = {
  dark: 'Dark theme',
  light: 'Light theme',
  system: 'Follows system theme',
};

export function Topbar({
  title,
  subtitle,
  actions,
  onToggleSidebar,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  onToggleSidebar?: () => void;
}) {
  const mode = useThemeStore((s) => s.mode);
  const cycle = useThemeStore((s) => s.cycle);

  return (
    <header className={styles.topbar}>
      {onToggleSidebar && (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={onToggleSidebar}
          aria-label="Toggle navigation"
        >
          ☰
        </Button>
      )}
      <div className={styles.titleGroup}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </div>
      <div className={styles.actions}>
        {actions}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={cycle}
          title={`${themeLabel[mode]} — click to change`}
          aria-label={`${themeLabel[mode]}. Click to change theme.`}
        >
          {themeIcon[mode]}
        </Button>
      </div>
    </header>
  );
}
