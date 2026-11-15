/**
 * The vault unlock token is a per-tab capability kept in JS memory only.
 * It is never persisted, so a reload or a new tab must re-enter the password.
 *
 * Stored on globalThis because dynamic chunks (settings, app shell) must share
 * exactly one header value; a module-local variable can be duplicated by the
 * bundler and leave one chunk thinking the vault is still unlocked.
 */
const KEY = '__nhVaultHeader';

export function setVaultHeader(value: string | null): void {
  (globalThis as unknown as Record<string, unknown>)[KEY] = value;
}

export function getVaultHeader(): string | null {
  return ((globalThis as unknown as Record<string, unknown>)[KEY] as string | null | undefined) ?? null;
}
