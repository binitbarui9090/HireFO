import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'hirefo.theme';

function readStored(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'dark' || value === 'light' || value === 'system') return value;
  } catch {
    /* private browsing */
  }
  return 'system';
}

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') return systemPrefersLight() ? 'light' : 'dark';
  return mode;
}

function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(mode));
}

interface ThemeState {
  mode: ThemeMode;
  resolved: 'dark' | 'light';
  setMode: (mode: ThemeMode) => void;
  /** Cycles dark -> light -> system, for the topbar toggle. */
  cycle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readStored(),
  resolved: resolveTheme(readStored()),

  setMode(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* private browsing */
    }
    applyTheme(mode);
    set({ mode, resolved: resolveTheme(mode) });
  },

  cycle() {
    const order: ThemeMode[] = ['dark', 'light', 'system'];
    const next = order[(order.indexOf(get().mode) + 1) % order.length]!;
    get().setMode(next);
  },
}));

/** Called once from main.tsx, before React renders, to avoid a theme flash. */
export function initTheme(): void {
  const mode = readStored();
  applyTheme(mode);

  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (useThemeStore.getState().mode === 'system') {
        applyTheme('system');
        useThemeStore.setState({ resolved: resolveTheme('system') });
      }
    });
  }
}
