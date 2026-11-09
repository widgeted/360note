import { Link } from 'react-router-dom';
import { getLocale } from '../lib/i18n';
import { SiteHeader } from '../components/SiteHeader';
import { SiteFooter } from '../components/SiteFooter';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export default function AboutPage() {
  const zh = getLocale() === 'zh-CN';
  useDocumentTitle(zh ? '关于' : 'About');
  return (
    <div className="legal-page about-page">
      <SiteHeader />
      <main className="legal-body">
        <h1>{zh ? '关于 360笔记' : 'About 360note'}</h1>
        <p className="about-lead">
          {zh
            ? '360笔记是一个安静、快速、本地优先的笔记空间：把记录、整理、搜索、分享与备份放在同一条路径上。'
            : '360note is a calm, fast, local-first notebook: capture, organization, search, sharing and backups live on one path.'}
        </p>

        <div className="prose">
          <h2>{zh ? '两个域名，一套账户' : 'Two domains, one account'}</h2>
          <p>
            {zh ? (
              <>
                <a href="https://360biji.com">360biji.com</a> 提供中文界面，
                <a href="https://360note.com">360note.com</a> 提供英文界面。账户、笔记、附件与团队空间完全互通，域名只决定界面与邮件语言。
              </>
            ) : (
              <>
                <a href="https://360biji.com">360biji.com</a> is the Chinese edition and{' '}
                <a href="https://360note.com">360note.com</a> is the English edition. Accounts, notes, attachments and team workspaces are fully shared; the domain only chooses the interface and email language.
              </>
            )}
          </p>

          <h2>{zh ? '我们坚持的事' : 'What we stand for'}</h2>
          {zh ? (
            <ul>
              <li><strong>数据属于你。</strong>正文以 Markdown 保存，单篇与全库都可以导出，备份可以下载。</li>
              <li><strong>能力边界透明。</strong>当前版本不提供端到端加密；服务器可以读取正文以支持搜索、分享与备份。附件与备份使用 AES-256-GCM 静态加密。</li>
              <li><strong>只发必要的邮件。</strong>注册与找回验证码、密码/邮箱变更通知、团队邀请，以及你主动请求的安全提醒。不发营销邮件。</li>
              <li><strong>界面克制。</strong>高频动作留在主路径，低频功能收进设置与命令面板。</li>
            </ul>
          ) : (
            <ul>
              <li><strong>Your data belongs to you.</strong> Notes are stored as Markdown and can be exported one at a time or as a full workspace; backups are downloadable.</li>
              <li><strong>Honest boundaries.</strong> This release does not provide end-to-end encryption. The server can read note bodies to provide search, sharing and backups. Attachments and backups use AES-256-GCM at rest.</li>
              <li><strong>Only essential email.</strong> Sign-up and recovery codes, password/email changes, workspace invitations, and security notices you request. No marketing email.</li>
              <li><strong>A quiet interface.</strong> High-frequency actions stay on the main path; low-frequency tools move into settings and the command palette.</li>
            </ul>
          )}

          <h2>{zh ? '联系' : 'Contact'}</h2>
          <p>
            {zh ? '产品、隐私与安全问题请联系 ' : 'For product, privacy and security questions, contact '}
            <a href="mailto:contact@360note.com">contact@360note.com</a>
            {zh ? '。公开问题也可以提交到 ' : '. Public issues are also welcome on '}
            <a href="https://github.com/widgeted/360note" rel="noreferrer">GitHub</a>
            {zh ? '。' : '.'}
          </p>
          <p>
            {zh ? '需要查看服务条款或隐私政策？' : 'Looking for the terms or privacy policy?'}{' '}
            <Link to="/terms">{zh ? '服务条款' : 'Terms'}</Link>
            {' · '}
            <Link to="/privacy">{zh ? '隐私政策' : 'Privacy'}</Link>
          </p>
        </div>

        <div className="about-note">
          {zh
            ? '此网站以及网站所展示的全部内容与“奇虎360”及其相关公司、组织、产品、品牌和商标无关。'
            : 'This website and its content are not affiliated with “Qihoo 360” or its related companies, organizations, products, brands or trademarks.'}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
