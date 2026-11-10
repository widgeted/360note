import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useT } from '../lib/i18n';

/**
 * VitePWA is configured with `registerType: 'prompt'`. A waiting worker would
 * otherwise stay dormant until every tab closes, so surface one explicit
 * update action and activate it only when the user asks.
 */
export function PwaUpdatePrompt() {
  const t = useT();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let disposed = false;

    const onControllerChange = () => {
      if (!refreshingRef.current) return;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const check = async () => {
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      if (!registration || disposed) return;
      if (registration.waiting && navigator.serviceWorker.controller) {
        setWaiting(registration.waiting);
        setDismissed(false);
      }
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller && !disposed) {
            setWaiting(registration.waiting ?? installing);
            setDismissed(false);
          }
        });
      });
      void registration.update().catch(() => {});
    };

    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!waiting || dismissed) return null;

  function update() {
    if (!waiting) return;
    setRefreshing(true);
    refreshingRef.current = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  return (
    <div className="pwa-install pwa-update" role="status" aria-live="polite">
      <span className="feature-icon" style={{ margin: 0, width: 34, height: 34, flex: 'none' }}>
        <RefreshCw size={15} />
      </span>
      <div className="pwa-install-body">
        <div className="pwa-install-title">{t('有新版本可用')}</div>
        <div className="pwa-install-text">{t('刷新后即可使用最新版本，本地草稿会保留。')}</div>
      </div>
      <div className="pwa-install-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={update} disabled={refreshing}>
          {refreshing ? <span className="spinner" /> : null} {t('刷新')}
        </button>
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => setDismissed(true)} aria-label={t('稍后提醒')}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
