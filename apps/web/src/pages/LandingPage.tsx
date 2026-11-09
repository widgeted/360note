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
import { getLocale } from '../lib/i18n';
import { LogoLockup } from '../components/Logo';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const copy = {
  zh: {
    langSwitch: 'English',
    langHref: 'https://360note.com',
    nav: ['功能', '安全', '关于'],
    login: '登录',
    start: '免费开始',
    eyebrow: '安静、快速、属于你的笔记空间',
    title: ['把想法留下，', '把知识连起来。'],
    lead: '360笔记把记录、整理、搜索、分享与备份放在同一条路径上。Markdown 为底，界面克制，数据随时可以带走。',
    cta: '创建免费账户',
    ctaGhost: '已有账户，登录',
    trust: ['邮箱注册', '支持离线', '数据可导出'],
    mockTitle: '欢迎来到 360笔记',
    mockLines: [
      '360笔记是一个安静、快速、属于你的笔记空间。',
      '它把记录、整理和分享放在同一条路径上，而不是让你先学习一套复杂的系统。',
    ],
    mockTags: ['开始', '产品', '灵感'],
    mockFolder: '开始使用',
    mockNotes: [
      { title: '欢迎来到 360笔记', excerpt: '把记录、整理、搜索和分享放在同一条路径上。', date: '今天', tag: '开始' },
      { title: 'Markdown 与排版速查', excerpt: '标题、列表、表格、任务与链接，底层都是 Markdown。', date: '昨天', tag: '参考' },
      { title: '本周产品会议', excerpt: '记录决策、负责人和下一步行动。', date: '周一', tag: '产品' },
    ],
    featuresTitle: '把一条笔记，变成可靠的工作方式。',
    featuresLead: '高频功能留在主路径，低频功能收进设置与命令面板。界面安静，能力完整。',
    features: [
      { title: '随手记录', body: '自动保存、草稿恢复、版本历史。Markdown 与富文本随时切换，内容始终是 Markdown。' },
      { title: '找得回来', body: '文件夹、标签、收藏、全文搜索与双向链接。标题、正文、标签、附件名都能搜。' },
      { title: '多端可用', body: '桌面三栏、移动单屏、可安装 PWA。离线继续写，联网自动同步，冲突保留副本。' },
      { title: '分享与协作', body: '只读、可评论、可编辑的分享链接，支持密码与有效期。团队空间提供成员角色与审计。' },
      { title: '数据可携带', body: '单篇导出 Markdown、HTML、PDF；全库导出 Markdown + 附件、HTML 站点或 JSON。' },
      { title: '独立备份', body: '自动与手动备份、恢复预览、加密存储、可选 S3 兼容异地备份。同步不是备份。' },
    ],
    domainsTitle: '两个域名，一套账户。',
    domainsLead: '360biji.com 提供中文界面，360note.com 提供英文界面。账户、笔记、附件与团队空间完全互通。',
    domains: [
      { host: '360biji.com', label: '中文版', body: '适合中文写作与阅读，界面、邮件与提示均为中文。' },
      { host: '360note.com', label: 'English', body: 'An English interface with the same account, notes and workspaces.' },
    ],
    securityTitle: '安全是默认值，不是附加项。',
    securityLead: '我们明确说明能力边界：当前版本不提供端到端加密，服务器可以读取正文以支持搜索、分享与备份。',
    security: [
      '全站 HTTPS/TLS',
      'scrypt 密码派生，不保存明文密码',
      '附件与备份 AES-256-GCM 加密',
      'TOTP 两步验证与备用码',
      '登录设备管理与会话撤销',
      '邮箱验证码与恢复密钥双路径找回',
    ],
    quote: '你的数据属于你。写下的内容应该随时可以带走，而不是成为留下的理由。',
    quoteSub: '从一篇笔记开始，不需要信用卡。',
    footerProduct: '产品',
    footerLegal: '法律',
    footerContact: '联系',
    footerLinks: ['功能', '安全', '关于', '隐私政策', '服务条款', '返回登录'],
    footerNote: '此网站与“奇虎360”及其相关公司、组织、产品、品牌和商标无关。',
  },
  en: {
    langSwitch: '中文',
    langHref: 'https://360biji.com',
    nav: ['Features', 'Security', 'About'],
    login: 'Sign in',
    start: 'Start free',
    eyebrow: 'A calm, fast notebook that belongs to you',
    title: ['Keep your ideas.', 'Connect your knowledge.'],
    lead: '360note puts capture, organization, search, sharing and backup on one path. Markdown underneath, a quiet interface on top, and your data always portable.',
    cta: 'Create a free account',
    ctaGhost: 'I already have an account',
    trust: ['Email sign-up', 'Works offline', 'Portable data'],
    mockTitle: 'Welcome to 360note',
    mockLines: [
      '360note is a calm, fast notebook that belongs to you.',
      'It keeps capture, organization and sharing on one path instead of asking you to learn a system first.',
    ],
    mockTags: ['Getting started', 'Product', 'Ideas'],
    mockFolder: 'Getting started',
    mockNotes: [
      { title: 'Welcome to 360note', excerpt: 'Capture, organize, search and share on one quiet path.', date: 'Today', tag: 'Start' },
      { title: 'Markdown & formatting', excerpt: 'Headings, lists, tables, tasks and links — all Markdown.', date: 'Yesterday', tag: 'Reference' },
      { title: 'Weekly product meeting', excerpt: 'Decisions, owners and the next steps from Tuesday.', date: 'Mon', tag: 'Product' },
    ],
    featuresTitle: 'Turn one note into a reliable way of working.',
    featuresLead: 'High-frequency actions stay on the main path; low-frequency settings move into settings and the command palette.',
    features: [
      { title: 'Capture quickly', body: 'Autosave, draft recovery and version history. Switch between rich text and Markdown while the source stays Markdown.' },
      { title: 'Find it again', body: 'Folders, tags, favorites, full-text search and backlinks. Search titles, body text, tags and attachment names.' },
      { title: 'Use it anywhere', body: 'Three columns on desktop, one screen on mobile, installable PWA. Write offline and sync when you reconnect; conflicts keep a copy.' },
      { title: 'Share and collaborate', body: 'View, comment and edit links with optional password and expiry. Team workspaces add roles, invitations and audit logs.' },
      { title: 'Take it with you', body: 'Export one note as Markdown, HTML or PDF; export a whole workspace as Markdown + attachments, an HTML site or JSON.' },
      { title: 'Back up independently', body: 'Automatic and manual backups, restore previews, encryption at rest and optional S3-compatible offsite copies. Sync is not backup.' },
    ],
    domainsTitle: 'Two domains. One account.',
    domainsLead: '360biji.com is the Chinese edition and 360note.com is the English edition. Accounts, notes, attachments and team workspaces are fully shared.',
    domains: [
      { host: '360biji.com', label: '中文版', body: '中文界面、中文邮件与提示，适合中文写作与阅读。' },
      { host: '360note.com', label: 'English', body: 'An English interface with the same account, notes and workspaces.' },
    ],
    securityTitle: 'Security is a default, not an afterthought.',
    securityLead: 'We are explicit about the boundary: this release does not provide end-to-end encryption. The server can read note bodies to provide search, sharing and backups.',
    security: [
      'HTTPS/TLS everywhere',
      'scrypt password hashing, never plaintext',
      'AES-256-GCM for attachments and backups',
      'TOTP two-factor authentication and backup codes',
      'Session and device review with revocation',
      'Email codes plus recovery keys for account recovery',
    ],
    quote: 'Your data belongs to you. What you write should always be portable, never held hostage.',
    quoteSub: 'Start with one note. No credit card required.',
    footerProduct: 'Product',
    footerLegal: 'Legal',
    footerContact: 'Contact',
    footerLinks: ['Features', 'Security', 'About', 'Privacy', 'Terms', 'Sign in'],
    footerNote: 'This website is not affiliated with “Qihoo 360” or its related companies, organizations, products, brands or trademarks.',
  },
};

const featureIcons = [Sparkles, Search, CloudOff, Users, Download, Lock];

export default function LandingPage() {
  const zh = getLocale() === 'zh-CN';
  useDocumentTitle();
  const c = zh ? copy.zh : copy.en;
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Link to="/" className="landing-brand" aria-label={zh ? '360笔记' : '360note'}>
            <LogoLockup />
          </Link>
          <nav className="landing-links" aria-label={zh ? '主导航' : 'Main navigation'}>
            <a href="#features">{c.nav[0]}</a>
            <a href="#security">{c.nav[1]}</a>
            <a href="/about.html">{c.nav[2]}</a>
          </nav>
          <div className="landing-actions">
            <a className="landing-lang" href={c.langHref}>{c.langSwitch}</a>
            <Link className="btn btn-ghost btn-sm landing-login" to="/login">{c.login}</Link>
            <Link className="btn btn-primary btn-sm" to="/register">{c.start}</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <div className="landing-eyebrow"><span className="landing-dot" />{c.eyebrow}</div>
            <h1>
              {c.title[0]}<br />
              <span>{c.title[1]}</span>
            </h1>
            <p className="landing-lead">{c.lead}</p>
            <div className="landing-cta">
              <Link className="btn btn-primary btn-lg" to="/register">
                {c.cta} <ArrowRight size={15} />
              </Link>
              <Link className="btn btn-secondary btn-lg" to="/login">{c.ctaGhost}</Link>
            </div>
            <ul className="landing-trust">
              {c.trust.map((item) => (
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
                    <span>{zh ? '我的空间' : 'My space'}</span>
                    <ChevronDown size={10} />
                  </div>
                  <div className="landing-mock-nav active"><Archive size={11} />{zh ? '全部笔记' : 'All notes'}<span className="landing-mock-count">{c.mockNotes.length + 9}</span></div>
                  <div className="landing-mock-nav"><Clock3 size={11} />{zh ? '最近编辑' : 'Recent'}</div>
                  <div className="landing-mock-nav"><Star size={11} />{zh ? '收藏' : 'Favorites'}</div>
                  <div className="landing-mock-nav"><Trash2 size={11} />{zh ? '回收站' : 'Trash'}</div>
                  <div className="landing-mock-label">{zh ? '文件夹' : 'Folders'}</div>
                  <div className="landing-mock-nav landing-mock-folder"><ChevronDown size={10} /><FolderTree size={11} />{c.mockFolder}</div>
                  <div className="landing-mock-label">{zh ? '标签' : 'Tags'}</div>
                  <div className="landing-mock-tags">
                    {c.mockTags.map((tag) => <span key={tag}># {tag}</span>)}
                  </div>
                </aside>
                <div className="landing-mock-list">
                  <div className="landing-mock-list-top">
                    <div className="landing-mock-search"><Search size={11} /><span>{zh ? '搜索笔记…' : 'Search notes…'}</span><kbd>⌘K</kbd></div>
                    <span className="landing-mock-new"><FilePlus2 size={12} /></span>
                  </div>
                  <div className="landing-mock-list-head">{zh ? '全部笔记' : 'All notes'}<span>{c.mockNotes.length + 9}</span></div>
                  {c.mockNotes.map((note, index) => (
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
                      <span>{zh ? '我的空间' : 'My space'}</span>
                      <ChevronRight size={10} />
                      <span>{c.mockFolder}</span>
                    </div>
                    <div className="landing-mock-save"><span className="landing-mock-save-dot" />{zh ? '已保存' : 'Saved'}</div>
                  </div>
                  <div className="landing-mock-doc">
                    <div className="landing-mock-title">{c.mockTitle}</div>
                    <div className="landing-mock-meta">{zh ? '刚刚编辑 · 1 分钟阅读' : 'Edited just now · 1 min read'}</div>
                    {c.mockLines.map((line) => <p key={line}>{line}</p>)}
                    <div className="landing-mock-section-title">{zh ? '从三个动作开始' : 'Start with three actions'}</div>
                    <ol className="landing-mock-steps">
                      <li><strong>{zh ? '写下来。' : 'Write.'}</strong> {zh ? '内容会自动保存。' : 'Everything autosaves.'}</li>
                      <li><strong>{zh ? '找回来。' : 'Find.'}</strong> {zh ? '搜索标题、正文、标签和附件名。' : 'Search titles, body text, tags and attachments.'}</li>
                      <li><strong>{zh ? '放心用。' : 'Relax.'}</strong> {zh ? '离线继续写，联网后自动同步。' : 'Write offline; sync when you reconnect.'}</li>
                    </ol>
                    <div className="landing-mock-quote">{zh ? '写下第一个想法，然后让它长成一套知识。' : 'Write the first idea, then let it grow into knowledge.'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-features" id="features">
          <div className="landing-section-head">
            <div>
              <div className="landing-kicker">{zh ? '能力' : 'Capabilities'}</div>
              <h2>{c.featuresTitle}</h2>
            </div>
            <p>{c.featuresLead}</p>
          </div>
          <div className="landing-feature-grid">
            {c.features.map((feature, index) => {
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
            <div className="landing-kicker">{zh ? '双语' : 'Bilingual'}</div>
            <h2>{c.domainsTitle}</h2>
            <p>{c.domainsLead}</p>
          </div>
          <div className="landing-domain-cards">
            {c.domains.map((domain) => (
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
            <div className="landing-kicker">{zh ? '安全' : 'Security'}</div>
            <h2>{c.securityTitle}</h2>
            <p>{c.securityLead}</p>
            <ul className="landing-security-list">
              {c.security.map((item) => (
                <li key={item}><Check size={14} />{item}</li>
              ))}
            </ul>
          </div>
          <div className="landing-security-card" aria-hidden="true">
            <div className="landing-security-row"><Lock size={16} /><span>TLS 1.3</span><em>{zh ? '传输加密' : 'In transit'}</em></div>
            <div className="landing-security-row"><ShieldCheck size={16} /><span>AES-256-GCM</span><em>{zh ? '静态加密' : 'At rest'}</em></div>
            <div className="landing-security-row"><KeyIcon /><span>TOTP</span><em>{zh ? '两步验证' : 'Two-factor'}</em></div>
            <div className="landing-security-row"><Download size={16} /><span>Markdown</span><em>{zh ? '可携带' : 'Portable'}</em></div>
            <div className="landing-security-foot">{zh ? '不提供 E2EE · 服务端可读正文以支持搜索与分享' : 'No E2EE · server-readable for search and sharing'}</div>
          </div>
        </section>

        <section className="landing-quote">
          <p>“{c.quote}”</p>
          <span>{c.quoteSub}</span>
          <Link className="btn btn-primary btn-lg" to="/register">{c.cta} <ArrowRight size={15} /></Link>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <LogoLockup />
            <p>{zh ? '一个安静、快速、本地优先的笔记空间。' : 'A calm, local-first notebook for ideas and knowledge.'}</p>
          </div>
          <div className="landing-footer-cols">
            <div>
              <h4>{c.footerProduct}</h4>
              <a href="#features">{c.footerLinks[0]}</a>
              <a href="#security">{c.footerLinks[1]}</a>
              <a href="/about.html">{c.footerLinks[2]}</a>
            </div>
            <div>
              <h4>{c.footerLegal}</h4>
              <Link to="/privacy">{c.footerLinks[3]}</Link>
              <Link to="/terms">{c.footerLinks[4]}</Link>
              <Link to="/login">{c.footerLinks[5]}</Link>
            </div>
            <div>
              <h4>{c.footerContact}</h4>
              <a href="mailto:noreply@360note.com">noreply@360note.com</a>
            </div>
          </div>
        </div>
        <div className="landing-footer-bottom">
          <span>© {new Date().getFullYear()} {zh ? '360笔记' : '360note'}</span>
          <span>{c.footerNote}</span>
        </div>
      </footer>
    </div>
  );
}

function KeyIcon() {
  return <Lock size={16} />;
}
