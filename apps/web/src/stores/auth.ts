import { create } from 'zustand';
import type { User, Workspace } from '@360note/shared';
import { api, ApiError } from '../lib/api';
import { getLocale } from '../lib/i18n';
import { clearSensitiveLocalData, setLocalWritesEnabled } from '../lib/offline';
import { useAppStore } from './app';

export interface InstanceInfo {
  version: string;
  registrationMode: 'open' | 'invite';
  aiEnabled: boolean;
  ocrEnabled: boolean;
  maxUploadBytes: number;
  publicOrigin: string;
}

interface AuthResponse {
  user: User;
  workspaces: Workspace[];
  instance: InstanceInfo;
}

interface RegisterResponse extends AuthResponse {
  recoveryKey: string;
  firstUser: boolean;
}

interface AuthState {
  user: User | null;
  workspaces: Workspace[];
  instance: InstanceInfo | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  error: string | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ twoFactorRequired: boolean; challengeToken?: string }>;
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<void>;
  register: (input: { email: string; displayName: string; password: string; inviteCode?: string; emailCode: string }) => Promise<RegisterResponse>;
  logout: (options?: { clearLocalData?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (user: User) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  clearError: () => void;
}

const AUTH_CACHE_KEY = 'nh-auth-cache';
const LAST_USER_KEY = 'nh-last-user-id';

function cacheAuth(response: AuthResponse): void {
  try {
    localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(response));
  } catch {
    /* ignore quota/private mode */
  }
}

function readCachedAuth(): AuthResponse | null {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthResponse;
    if (!parsed?.user?.id || !Array.isArray(parsed.workspaces)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearCachedAuth(): void {
  try {
    localStorage.removeItem(AUTH_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

async function applyAuth(response: AuthResponse): Promise<void> {
  let previousUserId: string | null = null;
  try {
    previousUserId = localStorage.getItem(LAST_USER_KEY);
  } catch {
    /* ignore private mode */
  }
  // A different account must never see the previous account's note bodies,
  // drafts or outbox. This also covers a first login on a shared browser.
  if (!previousUserId || previousUserId !== response.user.id) {
    await clearSensitiveLocalData();
    useAppStore.getState().reset();
  }
  setLocalWritesEnabled(true);
  try {
    localStorage.setItem(LAST_USER_KEY, response.user.id);
  } catch {
    /* ignore */
  }
  cacheAuth(response);
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  workspaces: [],
  instance: null,
  status: 'loading',
  error: null,

  bootstrap: async () => {
    try {
      const response = await api.get<AuthResponse>('/api/auth/me');
      await applyAuth(response);
      set({ user: response.user, workspaces: response.workspaces, instance: response.instance, status: 'authenticated', error: null });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearCachedAuth();
        useAppStore.getState().reset();
        set({ user: null, workspaces: [], status: 'anonymous', error: null });
      } else {
        // Offline/PWA: keep the cached identity so local notes remain available.
        const cached = readCachedAuth();
        if (cached) {
          set({
            user: cached.user,
            workspaces: cached.workspaces,
            instance: cached.instance,
            status: 'authenticated',
            error: 'offline',
          });
        } else {
          set({ status: 'anonymous', error: (error as Error).message });
        }
      }
    }
  },

  login: async (email, password) => {
    set({ error: null });
    const response = await api.post<
      | AuthResponse
      | { twoFactorRequired: true; challengeToken: string }
    >('/api/auth/login', { email, password });
    if ('twoFactorRequired' in response && response.twoFactorRequired) {
      return { twoFactorRequired: true, challengeToken: response.challengeToken };
    }
    await applyAuth(response as AuthResponse);
    set({
      user: (response as AuthResponse).user,
      workspaces: (response as AuthResponse).workspaces,
      instance: (response as AuthResponse).instance,
      status: 'authenticated',
    });
    return { twoFactorRequired: false };
  },

  verifyTwoFactor: async (challengeToken, code) => {
    const response = await api.post<AuthResponse>('/api/auth/login/2fa', { challengeToken, code });
    await applyAuth(response);
    set({ user: response.user, workspaces: response.workspaces, instance: response.instance, status: 'authenticated', error: null });
  },

  register: async (input) => {
    const response = await api.post<RegisterResponse>('/api/auth/register', {
      ...input,
      locale: getLocale(),
    });
    await applyAuth(response);
    set({ user: response.user, workspaces: response.workspaces, instance: response.instance, status: 'authenticated', error: null });
    return response;
  },

  logout: async (options) => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* clear local state regardless */
    }
    if (options?.clearLocalData) {
      await clearSensitiveLocalData();
      try {
        localStorage.removeItem(LAST_USER_KEY);
      } catch {
        /* ignore */
      }
    } else {
      clearCachedAuth();
    }
    useAppStore.getState().reset();
    set({ user: null, workspaces: [], status: 'anonymous', error: null });
  },

  refresh: async () => {
    try {
      const response = await api.get<AuthResponse>('/api/auth/me');
      await applyAuth(response);
      set({ user: response.user, workspaces: response.workspaces, instance: response.instance, status: 'authenticated' });
    } catch {
      /* leave state as is */
    }
  },

  setUser: (user) => {
    set({ user });
  },

  setWorkspaces: (workspaces) => set({ workspaces }),
  clearError: () => set({ error: null }),
}));
