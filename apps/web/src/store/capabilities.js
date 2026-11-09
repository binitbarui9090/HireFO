import { create } from 'zustand';
import { api } from '../lib/api';
export const useCapabilitiesStore = create((set, get) => ({
    data: null,
    error: null,
    async load() {
        if (get().data)
            return;
        try {
            set({ data: await api.get('/api/capabilities'), error: null });
        }
        catch {
            set({ error: 'Could not reach the HireFO API. Check that it is running on port 4000.' });
        }
    },
}));
export function useLanguage(id) {
    return useCapabilitiesStore((s) => s.data?.languages.find((l) => l.id === id) ?? null);
}
