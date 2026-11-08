import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import { useAppStore } from './stores/app';
import { ToastViewport } from './components/Toasts';
import { LogoLockup } from './components/Logo';
import { getLocale } from './lib/i18n';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import RecoverPage from './pages/RecoverPage';
import SharePage from './pages/SharePage';
import InvitePage from './pages/InvitePage';
import LegalPage from './pages/LegalPage';
import NotFoundPage from './pages/NotFoundPage';
import AppPage from './pages/AppPage';
import ClipPage from './pages/ClipPage';

function Splash() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--ink-950)',
        color: 'var(--sidebar-muted)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <LogoLockup inverse />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span className="spinner" />
          {getLocale() === 'zh-CN' ? '正在加载 360笔记…' : 'Loading 360note…'}
        </div>
      </div>
    </div>
  );
}

function SearchShortcut() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/app', { replace: true });
    const timer = window.setTimeout(() => window.dispatchEvent(new Event('nh:focus-search')), 450);
    return () => window.clearTimeout(timer);
  }, [navigate]);
  return <Splash />;
}

function Protected({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'anonymous') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

function HomeRoute() {
  const status = useAuthStore((state) => state.status);
  if (status === 'loading') return <Splash />;
  if (status === 'authenticated') return <Navigate to="/app" replace />;
  return <LandingPage />;
}

export default function App() {
  const status = useAuthStore((state) => state.status);
  const bootstrap = useAuthStore((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const onOnline = () => {
      useAppStore.getState().setOffline(false);
      void useAppStore.getState().flushOutbox();
    };
    const onOffline = () => useAppStore.getState().setOffline(true);
    const onUnauthorized = () => {
      localStorage.removeItem('nh-auth-cache');
      useAuthStore.setState({ user: null, workspaces: [], status: 'anonymous' });
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('nh:unauthorized', onUnauthorized);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('nh:unauthorized', onUnauthorized);
    };
  }, []);

  return (
    <>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/login" element={status === 'authenticated' ? <Navigate to="/app" replace /> : <LoginPage />} />
        <Route path="/register" element={status === 'authenticated' ? <Navigate to="/app" replace /> : <RegisterPage />} />
        <Route path="/recover" element={<RecoverPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/s/:token" element={<SharePage />} />
        <Route path="/privacy" element={<LegalPage kind="privacy" />} />
        <Route path="/terms" element={<LegalPage kind="terms" />} />
        <Route path="/clip" element={<Protected><ClipPage /></Protected>} />
        <Route path="/new" element={<Protected><Navigate to="/app/new" replace /></Protected>} />
        <Route path="/search" element={<Protected><SearchShortcut /></Protected>} />
        <Route path="/app/*" element={<Protected><AppPage /></Protected>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <ToastViewport />
    </>
  );
}
