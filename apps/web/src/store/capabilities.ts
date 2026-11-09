import { create } from 'zustand';
import type { AiSuggestionKind, Difficulty, LanguageId, QuestionCategory } from '@hirefo/shared';
import { api } from '../lib/api';

/**
 * The backend's capability descriptor, fetched once at boot.
 *
 * The UI reads this instead of assuming: which languages can actually be
 * executed, whether a real sandbox is in use, and whether an LLM provider is
 * configured. That is what keeps the interface honest when something is turned
 * off — the Run button is disabled with a reason rather than silently failing.
 */
export interface Capabilities {
  languages: {
    id: LanguageId;
    label: string;
    monacoId: string;
    executable: boolean;
    executionNote: string;
  }[];
  difficulties: readonly Difficulty[];
  categories: { id: QuestionCategory; label: string }[];
  recommendations: Record<string, string>;
  aiSuggestionKinds: Record<AiSuggestionKind, string>;
  execution: {
    runner: 'DOCKER' | 'LOCAL_SUBPROCESS';
    isolated: boolean;
    limits: {
      perCaseTimeoutMsDefault: number;
      memoryMb: number;
      cpus: number;
      maxSourceBytes: number;
      maxTestCases: number;
    };
    note: string;
  };
  ai: {
    enabled: boolean;
    provider: string;
    model: string | null;
    guardrailNotice: string;
    disabledReason: string | null;
  };
  analyticsDisclaimer: string;
}

interface CapabilitiesState {
  data: Capabilities | null;
  error: string | null;
  load: () => Promise<void>;
}

export const useCapabilitiesStore = create<CapabilitiesState>((set, get) => ({
  data: null,
  error: null,
  async load() {
    if (get().data) return;
    try {
      set({ data: await api.get<Capabilities>('/api/capabilities'), error: null });
    } catch {
      set({ error: 'Could not reach the HireFO API. Check that it is running on port 4000.' });
    }
  },
}));

export function useLanguage(id: string | null | undefined) {
  return useCapabilitiesStore((s) => s.data?.languages.find((l) => l.id === id) ?? null);
}
