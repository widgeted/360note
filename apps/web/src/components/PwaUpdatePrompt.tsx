import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useT } from '../lib/i18n';
import { PwaNotice } from './PwaNotice';

const APP_ROUTES = ['/app', '/new', '/search', '/clip'];
const DISMISSED_KEY = 'nh-pwa-update-dismissed-build';

/**
 * VitePWA is configured with `registerType: 'prompt'`. A waiting worker must
 * correspond to a genuinely newer build before we ask the user to refresh;
 * otherwise a stale waiting worker can produce a false "new version" prompt.
 */
export function PwaUpdatePrompt() {
  const t = useT();
  const location = useLocation();
  const inApp = APP_ROUTES.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`));
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const dismissedWorkerRef = useRef<ServiceWorker | null>(null);
  const waitingBuildRef = useRef<string | null>(null);

  useEffect(() => {
    if (!inApp || !('serviceWorker' in navigator)) {
      setWaiting(null);
      return;
    }
    let disposed = false;
    let registrationRef: ServiceWorkerRegistration | null = null;
    const currentBuild = document.querySelector<HTMLMetaElement>('meta[name="app-build"]')?.content ?? '';

    const onControllerChange = () => {
      if (!refreshingRef.current) return;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const newerBuild = async (): Promise<string | null> => {
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return null;
        const remote = (await response.json()) as { build?: string };
        if (!remote.build || !currentBuild || remote.build === currentBuild) return null;
        return remote.build;
      } catch {
        return null;
      }
    };

    const revealIfReal = async (registration: ServiceWorkerRegistration) => {
      const worker = registration.waiting;
      if (!worker || worker.state !== 'installed' || !navigator.serviceWorker.controller) {
        if (!worker) setWaiting(null);
        return;
      }
      if (dismissedWorkerRef.current === worker) return;
      // Do not show the prompt unless the server is actually serving a newer
      // build than the one this page was loaded from.
      const build = await newerBuild();
      if (!build) {
        setWaiting(null);
        return;
      }
      if (sessionStorage.getItem(DISMISSED_KEY) === build) return;
      if (!disposed) {
        waitingBuildRef.current = build;
        setWaiting(worker);
        setDismissed(false);
      }
    };

    const onUpdateFound = () => {
      const registration = registrationRef;
      const installing = registration?.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && registration && !disposed) {
          void revealIfReal(registration);
        }
      });
    };

    const check = async () => {
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      if (!registration || disposed) return;
      if (registrationRef !== registration) {
        registrationRef = registration;
        registration.addEventListener('updatefound', onUpdateFound);
      }
      await revealIfReal(registration);
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
  }, [inApp]);

  if (!inApp || !waiting || dismissed) return null;

  function update() {
    if (!waiting) return;
    setRefreshing(true);
    refreshingRef.current = true;
    // Give the editor a synchronous chance to persist its latest draft before
    // the new worker activates and the page reloads.
    window.dispatchEvent(new Event('nh:flush-before-reload'));
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // If a browser does not emit controllerchange, reload once so the user is
    // never left with a spinner and no visible result.
    window.setTimeout(() => window.location.reload(), 2500);
  }

  return (
    <PwaNotice
      placement="top"
      title={t('有新版本可用')}
      closeLabel={t('稍后提醒')}
      ariaLabel={t('有新版本可用')}
      icon={<RefreshCw size={16} />}
      onClose={() => {
        dismissedWorkerRef.current = waiting;
        if (waitingBuildRef.current) sessionStorage.setItem(DISMISSED_KEY, waitingBuildRef.current);
        setDismissed(true);
      }}
      actions={
        <button type="button" className="btn btn-primary btn-sm" onClick={update} disabled={refreshing}>
          {refreshing ? <span className="spinner" /> : null} {t('刷新')}
        </button>
      }
    >
      {t('刷新后即可使用最新版本，本地草稿会保留。')}
    </PwaNotice>
  );
}
