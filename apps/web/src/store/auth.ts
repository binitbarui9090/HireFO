import { create } from 'zustand';
import type { OrgRole } from '@hirefo/shared';
import { api, auth as tokenStore, ApiError, refreshAccessToken } from '../lib/api';
import { disconnectSocket, refreshSocketAuth } from '../lib/socket';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarColor: number;
}

export interface Membership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrgRole;
}

interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
  organizationId?: string;
  interviewId?: string | null;
}

interface MeResponse {
  user: SessionUser;
  memberships: Membership[];
}

/** Key for the remembered active organization. Never holds a token. */
const ORG_STORAGE_KEY = 'hirefo.activeOrg';

function readStoredOrg(): string | null {
  try {
    return localStorage.getItem(ORG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredOrg(orgId: string | null): void {
  try {
    if (orgId) localStorage.setItem(ORG_STORAGE_KEY, orgId);
    else localStorage.removeItem(ORG_STORAGE_KEY);
  } catch {
    /* private browsing: remembering the org is a convenience, not a requirement */
  }
}

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: SessionUser | null;
  memberships: Membership[];
  activeOrgId: string | null;
  error: string | null;

  /** Restores the session from the refresh cookie on first load. */
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    organizationName: string;
  }) => Promise<void>;
  acceptInvitation: (input: {
    token: string;
    name?: string;
    password?: string;
  }) => Promise<{ interviewId: string | null }>;
  logout: () => Promise<void>;
  setActiveOrg: (orgId: string) => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => {
  /** Applies an auth response: token into memory, user into the store. */
  const adopt = async (response: AuthResponse): Promise<void> => {
    tokenStore.setAccessToken(response.accessToken);
    const me = await api.get<MeResponse>('/api/auth/me');

    const preferred =
      response.organizationId ??
      readStoredOrg() ??
      me.memberships[0]?.organizationId ??
      null;
    const active = me.memberships.some((m) => m.organizationId === preferred)
      ? preferred
      : (me.memberships[0]?.organizationId ?? null);

    tokenStore.setActiveOrg(active);
    writeStoredOrg(active);
    refreshSocketAuth();

    set({
      status: 'authenticated',
      user: me.user,
      memberships: me.memberships,
      activeOrgId: active,
      error: null,
    });
  };

  const fail = (err: unknown): never => {
    const message =
      err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
    set({ error: message });
    throw err;
  };

  return {
    status: 'loading',
    user: null,
    memberships: [],
    activeOrgId: null,
    error: null,

    async bootstrap() {
      // A page reload loses the in-memory access token; the httpOnly refresh
      // cookie is what makes the session survive.
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        set({ status: 'anonymous', user: null, memberships: [], activeOrgId: null });
        return;
      }
      try {
        const me = await api.get<MeResponse>('/api/auth/me');
        const stored = readStoredOrg();
        const active = me.memberships.some((m) => m.organizationId === stored)
          ? stored
          : (me.memberships[0]?.organizationId ?? null);
        tokenStore.setActiveOrg(active);
        writeStoredOrg(active);
        refreshSocketAuth();
        set({
          status: 'authenticated',
          user: me.user,
          memberships: me.memberships,
          activeOrgId: active,
        });
      } catch {
        tokenStore.setAccessToken(null);
        set({ status: 'anonymous', user: null, memberships: [], activeOrgId: null });
      }
    },

    async login(email, password) {
      set({ error: null });
      try {
        const res = await api.post<AuthResponse>(
          '/api/auth/login',
          { email, password },
          { skipRefresh: true },
        );
        await adopt(res);
      } catch (err) {
        fail(err);
      }
    },

    async register(input) {
      set({ error: null });
      try {
        const res = await api.post<AuthResponse>('/api/auth/register', input, {
          skipRefresh: true,
        });
        await adopt(res);
      } catch (err) {
        fail(err);
      }
    },

    async acceptInvitation(input) {
      set({ error: null });
      try {
        const res = await api.post<AuthResponse>('/api/auth/invitations/accept', input, {
          skipRefresh: true,
        });
        await adopt(res);
        return { interviewId: res.interviewId ?? null };
      } catch (err) {
        return fail(err);
      }
    },

    async logout() {
      await api.post('/api/auth/logout').catch(() => undefined);
      tokenStore.setAccessToken(null);
      tokenStore.setActiveOrg(null);
      writeStoredOrg(null);
      disconnectSocket();
      set({ status: 'anonymous', user: null, memberships: [], activeOrgId: null, error: null });
    },

    setActiveOrg(orgId) {
      if (!get().memberships.some((m) => m.organizationId === orgId)) return;
      tokenStore.setActiveOrg(orgId);
      writeStoredOrg(orgId);
      set({ activeOrgId: orgId });
    },

    clearError() {
      set({ error: null });
    },
  };
});

/** The caller's role in the active organization. */
export function useActiveRole(): OrgRole | null {
  return useAuthStore(
    (s) => s.memberships.find((m) => m.organizationId === s.activeOrgId)?.role ?? null,
  );
}

export function useIsStaff(): boolean {
  const role = useActiveRole();
  return role === 'ADMIN' || role === 'INTERVIEWER';
}

/** Wires the API client's logout hook to the store exactly once. */
export function installAuthHooks(): void {
  tokenStore.onLogout(() => {
    disconnectSocket();
    useAuthStore.setState({
      status: 'anonymous',
      user: null,
      memberships: [],
      activeOrgId: null,
    });
  });
}
