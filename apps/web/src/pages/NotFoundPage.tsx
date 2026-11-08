import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export default function NotFoundPage() {
  const t = useT();
  useDocumentTitle(t('页面不存在'));
  return (
    <div className="notfound">
      <div>
        <div className="notfound-code">404</div>
        <h1>{t('页面不存在')}</h1>
        <p>{t('它可能已经被移动，或链接不完整。')}</p>
        <Link to="/" className="btn btn-primary"><ArrowLeft size={14} /> {t('返回首页')}</Link>
      </div>
    </div>
  );
}
