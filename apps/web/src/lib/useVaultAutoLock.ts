import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { useVaultStore } from '../stores/vault';

const IDLE_MS = 15 * 60 * 1000;
const TOUCH_MS = 5 * 60 * 1000;

/**
 * Lock the current encrypted space after 15 minutes without user input.
 * A throttled heartbeat keeps the server-side key alive while the user is
 * actively reading (which may not issue content requests).
 */
export function useVaultAutoLock(
  workspaceId: string | null,
  enabled: boolean,
  onLocked: () => void,
): void {
  const lockedRef = useRef(onLocked);
  lockedRef.current = onLocked;

  useEffect(() => {
    if (!workspaceId || !enabled) return;
    let idleTimer = 0;
    let lastTouch = 0;
    let lastReset = 0;
    let disposed = false;

    const lock = () => {
      if (disposed) return;
      disposed = true;
      void useVaultStore.getState().lock(workspaceId).finally(() => lockedRef.current());
    };

    const schedule = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(lock, IDLE_MS);
    };

    const touch = () => {
      const now = Date.now();
      if (now - lastTouch < TOUCH_MS) return;
      lastTouch = now;
      void api.post(`/api/workspaces/${workspaceId}/vault/touch`, {}).catch((error: unknown) => {
        if ((error as { status?: number }).status === 423) {
          useVaultStore.getState().invalidate(workspaceId);
          lockedRef.current();
        }
      });
    };

    const onActivity = () => {
      const now = Date.now();
      if (now - lastReset < 800) return;
      lastReset = now;
      schedule();
      touch();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') onActivity();
    };

    const onVaultLocked = () => {
      useVaultStore.getState().invalidate(workspaceId);
      lockedRef.current();
    };

    const events: Array<[string, EventListener]> = [
      ['pointerdown', onActivity],
      ['keydown', onActivity],
      ['mousemove', onActivity],
      ['scroll', onActivity],
      ['touchstart', onActivity],
    ];
    for (const [name, handler] of events) window.addEventListener(name, handler, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('nh:vault-locked', onVaultLocked);
    schedule();

    return () => {
      disposed = true;
      window.clearTimeout(idleTimer);
      for (const [name, handler] of events) window.removeEventListener(name, handler);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('nh:vault-locked', onVaultLocked);
    };
  }, [workspaceId, enabled]);
}
