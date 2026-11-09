import { Link } from 'react-router-dom';
import { getLocale, translate } from '../lib/i18n';
import { LogoLockup } from './Logo';

export function SiteFooter() {
  const zh = getLocale() === 'zh-CN';
  return (
    <footer className="landing-footer">
      <div className="landing-footer-inner">
        <div className="landing-footer-brand">
          <LogoLockup />
          <p>{zh ? '一个安静、快速、本地优先的笔记空间。' : 'A calm, local-first notebook for ideas and knowledge.'}</p>
        </div>
        <div className="landing-footer-cols">
          <div>
            <h4>{translate('产品')}</h4>
            <a href="/#features">{translate('功能')}</a>
            <a href="/#security">{translate('安全')}</a>
            <Link to="/about">{translate('关于')}</Link>
          </div>
          <div>
            <h4>{translate('法律')}</h4>
            <Link to="/privacy">{translate('隐私政策')}</Link>
            <Link to="/terms">{translate('服务条款')}</Link>
            <Link to="/login">{translate('登录')}</Link>
          </div>
          <div>
            <h4>{translate('联系')}</h4>
            <a href="mailto:contact@360note.com">contact@360note.com</a>
          </div>
        </div>
      </div>
      <div className="landing-footer-bottom">
        <span>© {new Date().getFullYear()} {zh ? '360笔记' : '360note'}</span>
        <span>{zh ? '此网站与“奇虎360”及其相关公司、组织、产品、品牌和商标无关。' : 'This website is not affiliated with “Qihoo 360” or its related companies, organizations, products, brands or trademarks.'}</span>
      </div>
    </footer>
  );
}
