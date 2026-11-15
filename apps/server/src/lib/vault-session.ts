import { currentSessionId, currentVaultToken } from './request-context.js';
import { errors } from './errors.js';
import { sha256 } from './crypto.js';

/**
 * Unlocked vault data keys live only in process memory, scoped to a
 * browser-tab unlock token and bound to a login session.
 *
 * - The token is returned once by /vault/unlock and kept in JS memory only,
 *   so a reload or a second tab must enter the space password again.
 * - Keys are never written to disk or logs.
 * - Sliding 15-minute idle timeout; a client heartbeat keeps it alive while
 *   the user is actively reading.
 */
export const VAULT_IDLE_MS = 15 * 60 * 1000;

interface Entry {
  key: Buffer;
  sessionId: string;
  expiresAt: number;
}

const keys = new Map<string, Entry>();

function cacheKey(workspaceId: string, token: string): string {
  return `${workspaceId}:${sha256(token)}`;
}

export function parseVaultHeader(raw: string | undefined | null): { workspaceId: string; token: string } | null {
  if (!raw) return null;
  const index = raw.indexOf('.');
  if (index <= 0 || index >= raw.length - 1) return null;
  return { workspaceId: raw.slice(0, index), token: raw.slice(index + 1) };
}

export function setVaultKey(workspaceId: string, token: string, sessionId: string, key: Buffer): number {
  const id = cacheKey(workspaceId, token);
  const existing = keys.get(id);
  if (existing) existing.key.fill(0);
  const expiresAt = Date.now() + VAULT_IDLE_MS;
  keys.set(id, { key: Buffer.from(key), sessionId, expiresAt });
  return expiresAt;
}

export function touchVaultKey(workspaceId: string, token: string, sessionId: string | undefined): Buffer | null {
  if (!sessionId) return null;
  const id = cacheKey(workspaceId, token);
  const entry = keys.get(id);
  if (!entry) return null;
  if (entry.sessionId !== sessionId || entry.expiresAt <= Date.now()) {
    entry.key.fill(0);
    keys.delete(id);
    return null;
  }
  entry.expiresAt = Date.now() + VAULT_IDLE_MS;
  return entry.key;
}

export function peekVaultKey(workspaceId: string, token: string, sessionId: string | undefined): Buffer | null {
  if (!sessionId) return null;
  const id = cacheKey(workspaceId, token);
  const entry = keys.get(id);
  if (!entry) return null;
  if (entry.sessionId !== sessionId || entry.expiresAt <= Date.now()) {
    entry.key.fill(0);
    keys.delete(id);
    return null;
  }
  return entry.key;
}

/** Key for the current request's tab token, without extending its timer. */
export function activeVaultKey(workspaceId: string): Buffer | null {
  const parsed = parseVaultHeader(currentVaultToken());
  if (!parsed || parsed.workspaceId !== workspaceId) return null;
  return peekVaultKey(workspaceId, parsed.token, currentSessionId());
}

export function requireActiveVaultKey(workspaceId: string): Buffer {
  const key = activeVaultKey(workspaceId);
  if (!key) throw errors.locked('加密空间已锁定，请输入空间密码');
  return key;
}

export function vaultKeyExpiresAt(workspaceId: string, token: string, sessionId: string | undefined): number | null {
  if (!sessionId) return null;
  const entry = keys.get(cacheKey(workspaceId, token));
  if (!entry || entry.sessionId !== sessionId || entry.expiresAt <= Date.now()) return null;
  return entry.expiresAt;
}

export function clearVaultKey(workspaceId: string, token: string): void {
  const id = cacheKey(workspaceId, token);
  const entry = keys.get(id);
  if (!entry) return;
  entry.key.fill(0);
  keys.delete(id);
}

export function clearWorkspaceVaultKeys(workspaceId: string): void {
  for (const [key, entry] of keys) {
    if (!key.startsWith(`${workspaceId}:`)) continue;
    entry.key.fill(0);
    keys.delete(key);
  }
}

export function clearSessionVaultKeys(sessionId: string): void {
  for (const [key, entry] of keys) {
    if (entry.sessionId !== sessionId) continue;
    entry.key.fill(0);
    keys.delete(key);
  }
}

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of keys) {
    if (entry.expiresAt > now) continue;
    entry.key.fill(0);
    keys.delete(key);
  }
}, 60_000);
sweeper.unref();
