import { Link } from 'react-router-dom';
import { useT } from '../lib/i18n';
import { SiteHeader } from '../components/SiteHeader';
import { SiteFooter } from '../components/SiteFooter';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export default function AboutPage() {
  const t = useT();
  useDocumentTitle(t('关于'));
  return (
    <div className="legal-page about-page">
      <SiteHeader />
      <main className="legal-body">
        <h1>{t('关于 360笔记')}</h1>
        <p className="about-lead">
          {t('360笔记是一个安静、快速、本地优先的笔记空间：把记录、整理、搜索、分享与备份放在同一条路径上。')}
        </p>

        <div className="prose">
          <h2>{t('两个域名，一套账户')}</h2>
          <p>
            <a href="https://360biji.com">360biji.com</a> {t('提供中文界面，')}
            <a href="https://360note.com">360note.com</a>{' '}
            {t('提供英文界面。账户、笔记、附件与团队空间完全互通，域名只决定界面与邮件语言。')}
          </p>

          <h2>{t('我们坚持的事')}</h2>
          <ul>
            <li><strong>{t('数据属于你。')}</strong>{t('正文以 Markdown 保存，单篇与全库都可以导出，备份可以下载。')}</li>
            <li><strong>{t('能力边界透明。')}</strong>{t('当前版本不提供端到端加密；服务器可以读取正文以支持搜索、分享与备份。附件与备份使用 AES-256-GCM 静态加密。')}</li>
            <li><strong>{t('只发必要的邮件。')}</strong>{t('注册与找回验证码、密码/邮箱变更通知、团队邀请，以及你主动请求的安全提醒。不发营销邮件。')}</li>
            <li><strong>{t('界面克制。')}</strong>{t('高频动作留在主路径，低频功能收进设置与命令面板。')}</li>
          </ul>

          <h2>{t('联系')}</h2>
          <p>
            {t('产品、隐私与安全问题请联系 ')}
            <a href="mailto:contact@360note.com">contact@360note.com</a>
            {t('。公开问题也可以提交到 ')}
            <a href="https://github.com/widgeted/360note" rel="noreferrer">GitHub</a>
            {t('。')}
          </p>
          <p>
            {t('需要查看服务条款或隐私政策？')}{' '}
            <Link to="/terms">{t('服务条款')}</Link>
            {' · '}
            <Link to="/privacy">{t('隐私政策')}</Link>
          </p>
        </div>

        <div className="about-note">
          {t('此网站以及网站所展示的全部内容与“奇虎360”及其相关公司、组织、产品、品牌和商标无关。')}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
