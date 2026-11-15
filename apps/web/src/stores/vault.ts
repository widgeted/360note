import { create } from 'zustand';
import { api } from '../lib/api';
import { setVaultHeader } from '../lib/vault-header';

interface VaultState {
  tokens: Record<string, string>;
  hasToken: (workspaceId: string) => boolean;
  setToken: (workspaceId: string, token: string) => void;
  invalidate: (workspaceId: string) => void;
  activate: (workspaceId: string) => void;
  deactivate: () => void;
  unlock: (workspaceId: string, password: string) => Promise<void>;
  recover: (workspaceId: string, recoveryKey: string, newPassword: string) => Promise<string>;
  lock: (workspaceId: string) => Promise<void>;
  changePassword: (workspaceId: string, currentPassword: string, newPassword: string) => Promise<void>;
  regenerateRecovery: (workspaceId: string, password: string) => Promise<string>;
}

function headerFor(workspaceId: string, token: string): string {
  return `${workspaceId}.${token}`;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  tokens: {},

  hasToken: (workspaceId) => Boolean(get().tokens[workspaceId]),

  setToken: (workspaceId, token) => {
    // The server returns a ready-to-send header (`workspaceId.token`) while
    // unlock stores the raw value. Normalize so both paths produce one prefix.
    const raw = token.startsWith(`${workspaceId}.`) ? token.slice(workspaceId.length + 1) : token;
    set((state) => ({ tokens: { ...state.tokens, [workspaceId]: raw } }));
    setVaultHeader(headerFor(workspaceId, raw));
  },

  invalidate: (workspaceId) => {
    set((state) => {
      const next = { ...state.tokens };
      delete next[workspaceId];
      return { tokens: next };
    });
    setVaultHeader(null);
  },

  activate: (workspaceId) => {
    const token = get().tokens[workspaceId];
    setVaultHeader(token ? headerFor(workspaceId, token) : null);
  },

  deactivate: () => setVaultHeader(null),

  unlock: async (workspaceId, password) => {
    const response = await api.post<{ unlocked: boolean; vaultToken?: string; expiresAt?: string }>(
      `/api/workspaces/${workspaceId}/vault/unlock`,
      { password },
    );
    if (!response.vaultToken) throw new Error('服务器未返回解锁凭证');
    get().setToken(workspaceId, response.vaultToken);
  },

  recover: async (workspaceId, recoveryKey, newPassword) => {
    const response = await api.post<{ recoveryKey: string; vaultToken?: string }>(
      `/api/workspaces/${workspaceId}/vault/recovery`,
      { recoveryKey, newPassword },
    );
    if (!response.vaultToken) throw new Error('服务器未返回解锁凭证');
    get().setToken(workspaceId, response.vaultToken);
    return response.recoveryKey;
  },

  lock: async (workspaceId) => {
    const token = get().tokens[workspaceId];
    if (token) {
      setVaultHeader(headerFor(workspaceId, token));
      try {
        await api.post(`/api/workspaces/${workspaceId}/vault/lock`, {});
      } catch {
        /* the server key expires anyway */
      }
    }
    get().invalidate(workspaceId);
  },

  changePassword: async (workspaceId, currentPassword, newPassword) => {
    const response = await api.post<{ ok: boolean; vaultToken?: string }>(
      `/api/workspaces/${workspaceId}/vault/password`,
      { currentPassword, newPassword },
    );
    if (response.vaultToken) get().setToken(workspaceId, response.vaultToken);
    else get().invalidate(workspaceId);
  },

  regenerateRecovery: async (workspaceId, password) => {
    const response = await api.post<{ recoveryKey: string }>(
      `/api/workspaces/${workspaceId}/vault/recovery/regenerate`,
      { password },
    );
    return response.recoveryKey;
  },
}));