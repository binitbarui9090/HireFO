import { create } from 'zustand';
let counter = 0;
export const useToastStore = create((set, get) => ({
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
    success: (title, description) => useToastStore.getState().push({ kind: 'success', title, ...(description ? { description } : {}) }),
    error: (title, description) => useToastStore.getState().push({ kind: 'error', title, ...(description ? { description } : {}) }),
    info: (title, description) => useToastStore.getState().push({ kind: 'info', title, ...(description ? { description } : {}) }),
    warning: (title, description) => useToastStore.getState().push({ kind: 'warning', title, ...(description ? { description } : {}) }),
};
