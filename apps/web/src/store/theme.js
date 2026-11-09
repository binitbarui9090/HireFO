import { create } from 'zustand';
const STORAGE_KEY = 'hirefo.theme';
function readStored() {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        if (value === 'dark' || value === 'light' || value === 'system')
            return value;
    }
    catch {
        /* private browsing */
    }
    return 'system';
}
function systemPrefersLight() {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
}
export function resolveTheme(mode) {
    if (mode === 'system')
        return systemPrefersLight() ? 'light' : 'dark';
    return mode;
}
function applyTheme(mode) {
    if (typeof document === 'undefined')
        return;
    document.documentElement.setAttribute('data-theme', resolveTheme(mode));
}
export const useThemeStore = create((set, get) => ({
    mode: readStored(),
    resolved: resolveTheme(readStored()),
    setMode(mode) {
        try {
            localStorage.setItem(STORAGE_KEY, mode);
        }
        catch {
            /* private browsing */
        }
        applyTheme(mode);
        set({ mode, resolved: resolveTheme(mode) });
    },
    cycle() {
        const order = ['dark', 'light', 'system'];
        const next = order[(order.indexOf(get().mode) + 1) % order.length];
        get().setMode(next);
    },
}));
/** Called once from main.tsx, before React renders, to avoid a theme flash. */
export function initTheme() {
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
