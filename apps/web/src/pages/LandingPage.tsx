import { Link } from 'react-router-dom';
import {
  Archive,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  CloudOff,
  Download,
  FilePlus2,
  FolderTree,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { getLocale, useT } from '../lib/i18n';
import { SiteHeader } from '../components/SiteHeader';
import { SiteFooter } from '../components/SiteFooter';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const featureIcons = [Sparkles, Search, CloudOff, Users, Download, Lock];

export default function LandingPage() {
  const t = useT();
  const zh = getLocale() === 'zh-CN';
  useDocumentTitle(undefined, {
    description: t('360笔记：一个安静、快速、本地优先的笔记空间。记录想法，建立联系，发布作品。'),
  });
  const mockNotes = [
    { title: t('欢迎来到 360笔记'), excerpt: t('把记录、整理、搜索和分享放在同一条路径上。'), date: t('今天'), tag: t('开始') },
    { title: t('Markdown 与排版速查'), excerpt: t('标题、列表、表格、任务与链接，底层都是 Markdown。'), date: t('昨天'), tag: t('参考') },
    { title: t('本周产品会议'), excerpt: t('记录决策、负责人和下一步行动。'), date: t('周一'), tag: t('产品') },
  ];
  const features = [
    { title: t('随手记录'), body: t('自动保存、草稿恢复、版本历史。Markdown 与富文本随时切换，内容始终是 Markdown。') },
    { title: t('找得回来'), body: t('文件夹、标签、收藏、全文搜索与双向链接。标题、正文、标签、附件名都能搜。') },
    { title: t('多端可用'), body: t('桌面三栏、移动单屏、可安装 PWA。离线继续写，联网自动同步，冲突保留副本。') },
    { title: t('分享与协作'), body: t('只读、可评论、可编辑的分享链接，支持密码与有效期。团队空间提供成员角色与审计。') },
    { title: t('数据可携带'), body: t('单篇导出 Markdown、HTML、PDF；全库导出 Markdown + 附件、HTML 站点或 JSON。') },
    { title: t('独立备份'), body: t('自动与手动备份、恢复预览、加密存储、可选 S3 兼容异地备份。同步不是备份。') },
  ];
  const domains = [
    { host: '360biji.com', label: t('中文版'), body: t('适合中文写作与阅读，界面、邮件与提示均为中文。') },
    { host: '360note.com', label: t('英文版'), body: t('英文界面，账户、笔记与空间与中文版完全共享。') },
  ];
  const security = [
    t('全站 HTTPS/TLS'),
    t('scrypt 密码派生，不保存明文密码'),
    t('附件与备份 AES-256-GCM 加密'),
    t('TOTP 两步验证与备用码'),
    t('登录设备管理与会话撤销'),
    t('邮箱验证码与恢复密钥双路径找回'),
  ];
  return (
    <div className="landing">
      <SiteHeader />

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <div className="landing-eyebrow"><span className="landing-dot" />{t('安静、快速、属于你的笔记空间')}</div>
            <h1>
              {t('把想法留下，')}<br />
              <span>{t('把知识连起来。')}</span>
            </h1>
            <p className="landing-lead">{t('360笔记把记录、整理、搜索、分享与备份放在同一条路径上。Markdown 为底，界面克制，数据随时可以带走。')}</p>
            <div className="landing-cta">
              <Link className="btn btn-primary btn-lg" to="/register">
                {t('创建免费账户')} <ArrowRight size={15} />
              </Link>
              <Link className="btn btn-secondary btn-lg" to="/login">{t('已有账户，登录')}</Link>
            </div>
            <ul className="landing-trust">
              {[t('邮箱注册'), t('支持离线'), t('数据可导出')].map((item) => (
                <li key={item}><Check size={13} />{item}</li>
              ))}
            </ul>
          </div>

          <div className="landing-stage" aria-hidden="true">
            <div className="landing-window">
              <div className="landing-window-bar">
                <span /><span /><span />
                <div className="landing-window-address">{(zh ? '360biji.com' : '360note.com') + '/app'}</div>
              </div>
              <div className="landing-window-body">
                <aside className="landing-mock-sidebar">
                  <div className="landing-mock-brand">
                    <img src={zh ? '/img/360biji.svg' : '/img/360note.svg'} alt="" />
                  </div>
                  <div className="landing-mock-workspace">
                    <span className="landing-mock-workspace-icon">◇</span>
                    <span>{t('我的空间')}</span>
                    <ChevronDown size={10} />
                  </div>
                  <div className="landing-mock-nav active"><Archive size={11} />{t('全部笔记')}<span className="landing-mock-count">{mockNotes.length + 9}</span></div>
                  <div className="landing-mock-nav"><Clock3 size={11} />{t('最近编辑')}</div>
                  <div className="landing-mock-nav"><Star size={11} />{t('收藏')}</div>
                  <div className="landing-mock-nav"><Trash2 size={11} />{t('回收站')}</div>
                  <div className="landing-mock-label">{t('文件夹')}</div>
                  <div className="landing-mock-nav landing-mock-folder"><ChevronDown size={10} /><FolderTree size={11} />{t('开始使用')}</div>
                  <div className="landing-mock-label">{t('标签')}</div>
                  <div className="landing-mock-tags">
                    {[t('开始'), t('产品'), t('灵感')].map((tag) => <span key={tag}># {tag}</span>)}
                  </div>
                </aside>
                <div className="landing-mock-list">
                  <div className="landing-mock-list-top">
                    <div className="landing-mock-search"><Search size={11} /><span>{t('搜索笔记…')}</span><kbd>⌘K</kbd></div>
                    <span className="landing-mock-new"><FilePlus2 size={12} /></span>
                  </div>
                  <div className="landing-mock-list-head">{t('全部笔记')}<span>{mockNotes.length + 9}</span></div>
                  {mockNotes.map((note, index) => (
                    <div key={note.title} className={index === 0 ? 'landing-mock-note active' : 'landing-mock-note'}>
                      <div className="landing-mock-note-title">{note.title}</div>
                      <div className="landing-mock-note-excerpt">{note.excerpt}</div>
                      <div className="landing-mock-note-meta">
                        <span>{note.date}</span>
                        <span className="landing-mock-mini-tag">{note.tag}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="landing-mock-editor">
                  <div className="landing-mock-topbar">
                    <div className="landing-mock-breadcrumb">
                      <span>{t('我的空间')}</span>
                      <ChevronRight size={10} />
                      <span>{t('开始使用')}</span>
                    </div>
                    <div className="landing-mock-save"><span className="landing-mock-save-dot" />{t('已保存')}</div>
                  </div>
                  <div className="landing-mock-doc">
                    <div className="landing-mock-title">{t('欢迎来到 360笔记')}</div>
                    <div className="landing-mock-meta">{t('刚刚编辑 · 1 分钟阅读')}</div>
                    {[t('360笔记是一个安静、快速、属于你的笔记空间。'), t('它把记录、整理和分享放在同一条路径上，而不是让你先学习一套复杂的系统。')].map((line) => <p key={line}>{line}</p>)}
                    <div className="landing-mock-section-title">{t('从三个动作开始')}</div>
                    <ol className="landing-mock-steps">
                      <li><strong>{t('写下来。')}</strong> {t('内容会自动保存。')}</li>
                      <li><strong>{t('找回来。')}</strong> {t('搜索标题、正文、标签和附件名。')}</li>
                      <li><strong>{t('放心用。')}</strong> {t('离线继续写，联网后自动同步。')}</li>
                    </ol>
                    <div className="landing-mock-quote">{t('写下第一个想法，然后让它长成一套知识。')}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-features" id="features">
          <div className="landing-section-head">
            <div>
              <div className="landing-kicker">{t('能力')}</div>
              <h2>{t('把一条笔记，变成可靠的工作方式。')}</h2>
            </div>
            <p>{t('高频功能留在主路径，低频功能收进设置与命令面板。界面安静，能力完整。')}</p>
          </div>
          <div className="landing-feature-grid">
            {features.map((feature, index) => {
              const Icon = featureIcons[index % featureIcons.length];
              return (
                <article className="landing-feature" key={feature.title}>
                  <span className="landing-feature-icon"><Icon size={17} /></span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="landing-domains">
          <div className="landing-domains-copy">
            <div className="landing-kicker">{t('双语')}</div>
            <h2>{t('两个域名，一套账户。')}</h2>
            <p>{t('360biji.com 提供中文界面，360note.com 提供英文界面。账户、笔记、附件与团队空间完全互通。')}</p>
          </div>
          <div className="landing-domain-cards">
            {domains.map((domain) => (
              <a className="landing-domain" href={`https://${domain.host}`} key={domain.host}>
                <div className="landing-domain-head">
                  <span>{domain.label}</span>
                  <ArrowRight size={14} />
                </div>
                <strong>{domain.host}</strong>
                <p>{domain.body}</p>
              </a>
            ))}
          </div>
        </section>

        <section className="landing-security" id="security">
          <div className="landing-security-copy">
            <div className="landing-kicker">{t('安全')}</div>
            <h2>{t('安全是默认值，不是附加项。')}</h2>
            <p>{t('我们明确说明能力边界：当前版本不提供端到端加密，服务器可以读取正文以支持搜索、分享与备份。')}</p>
            <ul className="landing-security-list">
              {security.map((item) => (
                <li key={item}><Check size={14} />{item}</li>
              ))}
            </ul>
          </div>
          <div className="landing-security-card" aria-hidden="true">
            <div className="landing-security-row"><Lock size={16} /><span>TLS 1.3</span><em>{t('传输加密')}</em></div>
            <div className="landing-security-row"><ShieldCheck size={16} /><span>AES-256-GCM</span><em>{t('静态加密')}</em></div>
            <div className="landing-security-row"><KeyIcon /><span>TOTP</span><em>{t('两步验证')}</em></div>
            <div className="landing-security-row"><Download size={16} /><span>Markdown</span><em>{t('可携带')}</em></div>
            <div className="landing-security-foot">{t('不提供 E2EE · 服务端可读正文以支持搜索与分享')}</div>
          </div>
        </section>

        <section className="landing-quote">
          <p>“{t('你的数据属于你。写下的内容应该随时可以带走，而不是成为留下的理由。')}”</p>
          <span>{t('从一篇笔记开始，不需要信用卡。')}</span>
          <Link className="btn btn-primary btn-lg" to="/register">{t('创建免费账户')} <ArrowRight size={15} /></Link>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function KeyIcon() {
  return <Lock size={16} />;
}
