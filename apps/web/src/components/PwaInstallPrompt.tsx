import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Share, X } from 'lucide-react';
import { useT } from '../lib/i18n';

const STORAGE_KEY = 'nh-pwa-install-v1';
const SHOW_DELAY_MS = 10_000;

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  return (
    /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua))
  );
}

function isInAppBrowser(): boolean {
  return /MicroMessenger|QQ\/|Weibo|FBAN|FBAV|Instagram|Line\//i.test(navigator.userAgent);
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|mercury/i.test(ua);
}

export function PwaInstallPrompt() {
  const t = useT();
  const location = useLocation();
  const [mode, setMode] = useState<'ios' | 'chromium' | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (location.pathname !== '/app') {
      setMode(null);
      return;
    }
    if (localStorage.getItem(STORAGE_KEY)) return;
    if (isStandalone() || !isMobileDevice() || isInAppBrowser()) return;

    const ios = isIosSafari();
    let timer: number | null = null;
    let availableListener: (() => void) | null = null;

    const schedule = () => {
      if (timer !== null || localStorage.getItem(STORAGE_KEY)) return;
      if (!ios && !(window as unknown as { __nhInstallPrompt?: InstallPromptEvent }).__nhInstallPrompt) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (localStorage.getItem(STORAGE_KEY) || document.visibilityState !== 'visible') return;
        localStorage.setItem(STORAGE_KEY, 'shown');
        setMode(ios ? 'ios' : 'chromium');
      }, SHOW_DELAY_MS);
    };

    if (ios) {
      schedule();
    } else if ((window as unknown as { __nhInstallPrompt?: InstallPromptEvent }).__nhInstallPrompt) {
      schedule();
    } else {
      availableListener = () => schedule();
      window.addEventListener('nh:install-available', availableListener);
    }

    const onInstalled = () => {
      localStorage.setItem(STORAGE_KEY, 'installed');
      setMode(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      if (availableListener) window.removeEventListener('nh:install-available', availableListener);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [location.pathname]);

  if (!mode) return null;

  async function install() {
    const prompt = (window as unknown as { __nhInstallPrompt?: InstallPromptEvent }).__nhInstallPrompt;
    if (!prompt) return;
    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      localStorage.setItem(STORAGE_KEY, choice.outcome === 'accepted' ? 'installed' : 'dismissed');
      setMode(null);
    } catch {
      localStorage.setItem(STORAGE_KEY, 'dismissed');
      setMode(null);
    } finally {
      setInstalling(false);
    }
  }

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, 'dismissed');
    setMode(null);
  }

  return (
    <div className="pwa-install" role="dialog" aria-live="polite" aria-label={t('添加到主屏幕')}>
      <img className="pwa-install-icon" src="/icons/icon-192.png" alt="" />
      <div className="pwa-install-body">
        <div className="pwa-install-title">{t('把 360笔记添加到主屏幕')}</div>
        <div className="pwa-install-text">
          {mode === 'ios' ? (
            <>
              {t('点击 Safari 的分享按钮')} <Share size={12} /> {t('，再选择“添加到主屏幕”。')}
            </>
          ) : (
            t('安装后可以像 App 一样打开，离线草稿仍会保留。')
          )}
        </div>
      </div>
      <div className="pwa-install-actions">
        {mode === 'chromium' && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void install()} disabled={installing}>
            {installing ? <span className="spinner" /> : null} {t('安装')}
          </button>
        )}
        <button type="button" className="icon-btn icon-btn-sm" onClick={dismiss} title={t('不再提示')} aria-label={t('不再提示')}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
