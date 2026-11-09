import { Link } from 'react-router-dom';
import { getLocale, translate } from '../lib/i18n';
import { LogoLockup } from './Logo';

export function SiteHeader() {
  const zh = getLocale() === 'zh-CN';
  const langHref = zh ? 'https://360note.com' : 'https://360biji.com';
  return (
    <header className="landing-nav">
      <div className="landing-nav-inner">
        <Link to="/" className="landing-brand" aria-label={zh ? '360笔记' : '360note'}>
          <LogoLockup />
        </Link>
        <nav className="landing-links" aria-label={zh ? '主导航' : 'Main navigation'}>
          <a href="/#features">{translate('功能')}</a>
          <a href="/#security">{translate('安全')}</a>
          <Link to="/about">{translate('关于')}</Link>
        </nav>
        <div className="landing-actions">
          <a className="landing-lang" href={langHref}>{zh ? 'English' : '中文'}</a>
          <Link className="btn btn-ghost btn-sm landing-login" to="/login">{translate('登录')}</Link>
          <Link className="btn btn-primary btn-sm" to="/register">{translate('免费开始')}</Link>
        </div>
      </div>
    </header>
  );
}
