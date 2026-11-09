import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  /** Milliseconds; 0 keeps it until dismissed. */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push(toast) {
    counter += 1;
    const id = `toast-${counter}`;
    const duration = toast.duration ?? (toast.kind === 'error' ? 8_000 : 4_000);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id, duration }] }));
    if (duration > 0) {
      setTimeout(() => get().dismiss(id), duration);
    }
    return id;
  },

  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  clear() {
    set({ toasts: [] });
  },
}));

/** Convenience helpers so components do not reach into the store directly. */
export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'success', title, ...(description ? { description } : {}) }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'error', title, ...(description ? { description } : {}) }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'info', title, ...(description ? { description } : {}) }),
  warning: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'warning', title, ...(description ? { description } : {}) }),
};
