import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getLocale, useT } from '../lib/i18n';
import { LogoLockup } from '../components/Logo';

export default function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const t = useT();
  const en = getLocale() === 'en';
  return (
    <div className="legal-page">
      <div className="legal-nav">
        <Link to="/" aria-label="360note"><LogoLockup /></Link>
        <Link to="/" className="btn btn-ghost btn-sm"><ArrowLeft size={13} /> {t('返回首页')}</Link>
      </div>
      <div className="legal-body">
        {kind === 'privacy' ? (
          en ? <PrivacyEn /> : <PrivacyZh />
        ) : en ? <TermsEn /> : <TermsZh />}
      </div>
    </div>
  );
}

function PrivacyZh() {
  return (
    <>
      <h1>隐私政策</h1>
      <div className="legal-date">生效日期：2026 年 11 月 8 日 · 适用于 360note.com、360biji.com 及其 www 子域名</div>
      <div className="prose">
        <p>360note（中文名“360笔记”）的设计原则是：只收集让服务正常工作所必需的数据，并且让你随时能够带走或删除它。这份政策用直白的语言说明我们做什么、不做什么。360biji.com 是中文版，360note.com 是英文版，两者使用同一套账户与内容。</p>

        <h2>1. 我们收集什么</h2>
        <ul>
          <li><strong>账户数据：</strong>邮箱地址、昵称、密码哈希（使用 scrypt 派生，服务器不保存明文密码）、邮箱验证记录、创建时间。</li>
          <li><strong>内容数据：</strong>你的笔记、文件夹、标签、评论、附件、历史版本与分享链接。</li>
          <li><strong>安全数据：</strong>登录会话、设备信息（浏览器 User-Agent）、IP 地址、登录尝试、审计日志。它们用于保护账户、排查滥用和满足安全审计需要。</li>
          <li><strong>偏好数据：</strong>主题、语言、编辑器设置等。</li>
        </ul>
        <p>我们不收集广告标识符，不加载第三方行为分析脚本，不使用跨站跟踪像素。</p>

        <h2>2. 我们不会做什么</h2>
        <ul>
          <li>不发送营销邮件。我们只发送账户必需的邮件：注册与找回密码验证码、密码重置通知、空间邀请，以及你主动请求的安全提醒。评论、异常登录等日常通知仍然在应用内显示。</li>
          <li>不把笔记内容出售、出租或用于训练 AI 模型。</li>
          <li>不在未经你主动触发的情况下把笔记发送给 AI 服务。AI 摘要默认关闭，且每次调用都由你点击触发。</li>
          <li>不在分享页面加载第三方广告或跟踪代码。</li>
        </ul>

        <h2>3. 数据如何存储与保护</h2>
        <ul>
          <li>所有页面与接口通过 HTTPS/TLS 传输。</li>
          <li>附件在服务器上使用 AES-256-GCM 加密存放；数据库中的笔记正文依赖服务器磁盘与数据库访问控制。</li>
          <li>密码使用 scrypt 加盐派生。会话令牌只以哈希形式存储，Cookie 设置为 HttpOnly、SameSite=Lax，生产环境启用 Secure。</li>
          <li>支持 TOTP 两步验证、备用码、登录设备列表与撤销、异常登录应用内提醒。</li>
          <li>备份文件在服务器上加密存放；实例管理员可选配置 S3 兼容异地存储。你可以随时下载标准格式的导出或完整备份。</li>
        </ul>
        <p><strong>关于端到端加密：</strong>当前版本没有启用端到端加密（E2EE）。这意味着服务器在技术上能够读取笔记正文以提供全文搜索、分享与备份。我们已把恢复密钥、加密存储与可导出备份作为基础能力。未来若提供 E2EE，会明确说明它会使服务端搜索、AI、协作与密码找回失效，并提供恢复密钥与应急机制。</p>

        <h2>4. 分享与公开页面</h2>
        <p>分享链接是一种能力（capability）：任何获得链接的人都可以按链接权限访问。你可以设置密码、过期时间，并随时撤销。公开页面可能被搜索引擎索引；请不要在分享内容中放入敏感信息。</p>

        <h2>5. Cookie 与本地存储</h2>
        <p>我们只使用必要的 Cookie：登录会话、受密码保护分享的短期访问凭证。浏览器本地存储用于主题、语言与离线缓存（IndexedDB），不会用于广告画像。</p>

        <h2>6. 数据保留</h2>
        <ul>
          <li>回收站中的笔记保留 30 天，之后可被永久清理。</li>
          <li>自动备份默认每日运行，保留 14 份自动备份，并在 30 天后清理旧备份（可在实例设置中调整）。</li>
          <li>审计日志与登录尝试用于安全审计，由实例管理员按需保留。</li>
          <li>注销账户时，个人空间与附件会被删除；团队空间需先转移所有权，以避免影响其他成员。</li>
        </ul>

        <h2>7. 你的权利</h2>
        <ul>
          <li><strong>访问与导出：</strong>你可以导出单篇笔记为 Markdown/HTML/PDF，或导出整个空间为 Markdown + 附件、HTML 站点或 JSON 数据。</li>
          <li><strong>更正：</strong>你可以随时修改笔记、账户昵称与偏好。</li>
          <li><strong>删除：</strong>你可以删除单篇、批量删除或清空回收站，也可以在设置中注销账户。删除个人数据是立即的；备份中的副本会在保留周期结束后清除。</li>
          <li><strong>可携带：</strong>导出格式是可重建的，不依赖专有阅读器。</li>
        </ul>

        <h2>8. 安全事件</h2>
        <p>如果发生影响你数据的安全事件，我们会在应用内通知受影响的账户，必要时也会通过账户邮箱联系你，并说明影响范围、已采取的措施与建议操作。</p>

        <h2>9. 联系我们</h2>
        <p>本实例由域名所有者运营。你可以通过 noreply@360note.com 提出隐私问题。我们只会发送账户与安全相关的邮件，不会发送营销邮件。</p>

        <h2>10. 变更</h2>
        <p>当这份政策发生重大变化时，我们会在应用内提示，并更新生效日期。继续使用即表示你接受更新后的政策。</p>
      </div>
    </>
  );
}

function PrivacyEn() {
  return (
    <>
      <h1>Privacy policy</h1>
      <div className="legal-date">Effective November 8, 2026 · Applies to 360note.com, 360biji.com and their www subdomains</div>
      <div className="prose">
        <p>360note (360笔记 in Chinese) collects only what is necessary to run the service, and makes it easy for you to take your data out or delete it. 360note.com is the English edition and 360biji.com is the Chinese edition; both share one account system and one content store.</p>
        <h2>What we collect</h2>
        <ul>
          <li><strong>Account data:</strong> email, display name, scrypt password hash, email verification records, timestamps.</li>
          <li><strong>Content:</strong> notes, folders, tags, comments, attachments, versions and share links.</li>
          <li><strong>Security data:</strong> sessions, browser user agent, IP address, login attempts and audit logs.</li>
          <li><strong>Preferences:</strong> theme, language and editor settings.</li>
        </ul>
        <h2>What we never do</h2>
        <ul>
          <li>No marketing email. We only send account-essential email: sign-up and password-reset codes, password-change notices, workspace invitations, and security alerts you request. Routine notices such as comments and unusual sign-ins stay in-app.</li>
          <li>No selling or renting your content; no training AI on your notes.</li>
          <li>No sending notes to an AI service unless you explicitly trigger it. AI summaries are off by default.</li>
          <li>No third-party ads or behavioral analytics on shared pages.</li>
        </ul>
        <h2>Security</h2>
        <p>TLS everywhere. Attachments are encrypted at rest with AES-256-GCM. Passwords are derived with scrypt; session tokens are stored hashed. TOTP two-factor authentication, device review and in-app sign-in alerts are available. Backups are encrypted at rest and can be downloaded at any time.</p>
        <p><strong>End-to-end encryption:</strong> E2EE is not enabled in this release. The server can technically read note bodies to provide full-text search, sharing and backups. If E2EE is introduced, we will explain its impact on server search, AI, collaboration and password recovery, and provide recovery-key and emergency procedures.</p>
        <h2>Sharing</h2>
        <p>Share links are capabilities: anyone with the link can access it according to its permission. You can require a password, set an expiry and revoke it. Public pages may be indexed by search engines; do not share sensitive material.</p>
        <h2>Cookies and local storage</h2>
        <p>We use only necessary cookies for sessions and password-protected share access. Browser storage is used for theme, language and offline cache.</p>
        <h2>Retention and your rights</h2>
        <p>Trash keeps notes for 30 days. Automatic backups run daily with 14 copies retained for up to 30 days. You can export a single note or the whole workspace, correct your data, delete notes, empty trash, or delete your account. Team workspaces must transfer ownership first so other members are not affected.</p>
        <h2>Security incidents and changes</h2>
        <p>If an incident affects your data, we will notify affected accounts in-app and, when necessary, by account email, with scope, mitigation and recommended actions. Material policy changes will be announced in-app with a new effective date.</p>
      </div>
    </>
  );
}

function TermsZh() {
  return (
    <>
      <h1>服务条款</h1>
      <div className="legal-date">生效日期：2026 年 11 月 8 日 · 适用于 360note.com、360biji.com 及其 www 子域名</div>
      <div className="prose">
        <p>欢迎使用 360note（中文名“360笔记”）。使用本服务即表示你同意以下条款。如果你不同意，请不要创建账户或继续使用。</p>
        <h2>1. 服务内容</h2>
        <p>360note 是一个笔记、知识整理与发布服务，提供编辑、组织、搜索、同步、分享、导出与备份等能力。360biji.com 提供中文界面，360note.com 提供英文界面，两者共享账户与内容。服务可能随版本迭代增加、调整或移除功能；重要变化会在应用内说明。</p>
        <h2>2. 账户</h2>
        <ul>
          <li>你需要提供有效的邮箱地址与足够强的密码，并通过邮箱验证码完成注册，对账户下的活动负责。</li>
          <li>忘记密码时，你可以使用邮箱验证码或恢复密钥重置。请妥善保管恢复密钥。恢复密钥只显示一次，丢失后无法找回，实例管理员也可能无法恢复你的账户。</li>
          <li>你可以开启两步验证并管理登录设备。发现异常登录时，应立即撤销会话并修改密码。</li>
          <li>首个注册账户会成为实例管理员，拥有管理实例设置与用户的能力。</li>
        </ul>
        <h2>3. 内容与所有权</h2>
        <p>你保留自己内容的全部权利。我们不主张对你笔记、附件或分享页面的所有权。你授予我们一项有限的、必要的许可，用于存储、传输、备份、搜索与展示这些内容，以提供你请求的服务。</p>
        <h2>4. 可接受使用</h2>
        <ul>
          <li>不得上传违法内容、恶意软件，或利用服务攻击他人、发送垃圾信息、绕过访问控制。</li>
          <li>不得尝试探测、扫描或破坏服务，不得滥用分享链接或 API。</li>
          <li>不得使用自动化手段对服务造成不合理负载；API 调用应遵守限流与权限。</li>
          <li>团队空间管理员应合理管理成员权限与审计记录。</li>
        </ul>
        <h2>5. 备份与可用性</h2>
        <p>我们提供自动备份与手动导出，但任何在线服务都无法保证绝对不丢失数据。请定期下载全库导出或备份，并保存到独立位置。<strong>同步不是备份</strong>：误删或勒索加密可能同步到所有设备，备份则不会。</p>
        <p>服务按现状提供，可能存在中断、缺陷或维护窗口。我们会尽力保持稳定，但不对因服务中断造成的间接损失承担责任。</p>
        <h2>6. 分享与公开内容</h2>
        <p>你对自己创建的分享链接及其权限负责。公开页面可能被搜索引擎索引，任何获得链接的人都可以按权限访问。请在分享前确认内容不包含敏感信息。</p>
        <h2>7. 数据删除</h2>
        <p>你可以删除笔记、清空回收站或注销账户。个人空间将被删除；团队空间需先转移所有权。备份中的历史副本会在保留周期结束后清除。删除操作不可撤销，除非你从自己的导出或备份中恢复。</p>
        <h2>8. 终止</h2>
        <p>如果你严重违反这些条款、危害服务或其他用户，我们可以限制或终止你的访问。你可以随时停止使用并导出数据。</p>
        <h2>9. 责任限制</h2>
        <p>在法律允许的范围内，对于因使用或无法使用本服务导致的间接、附带、特殊或惩罚性损害，我们不承担责任。若适用法律不允许此类限制，则以法律要求为准。</p>
        <h2>10. 条款变更</h2>
        <p>我们可能更新这些条款。重大变更会在应用内通知。变更后继续使用视为接受新条款。若你不同意，请停止使用并导出数据。</p>
      </div>
    </>
  );
}

function TermsEn() {
  return (
    <>
      <h1>Terms of service</h1>
      <div className="legal-date">Effective November 8, 2026 · Applies to 360note.com, 360biji.com and their www subdomains</div>
      <div className="prose">
        <p>By using 360note you agree to these terms. If you do not agree, do not create an account.</p>
        <h2>The service</h2>
        <p>360note provides note-taking, organization, search, sync, sharing, export and backup. 360note.com is the English edition and 360biji.com is the Chinese edition; both share accounts and content. Features may change over time; material changes will be announced in-app.</p>
        <h2>Accounts</h2>
        <ul>
          <li>Provide a valid email and a strong password, and verify the email with a one-time code when you register. You are responsible for activity in your account.</li>
          <li>You can reset your password with an email code or your recovery key. Store the recovery key safely: it is shown once and cannot be recovered.</li>
          <li>Enable two-factor authentication and review devices. If you notice unusual activity, revoke sessions and change your password.</li>
        </ul>
        <h2>Your content</h2>
        <p>You retain all rights to your content. We claim no ownership. You grant us the limited permission needed to store, transmit, back up, search and display content in order to provide the service you request.</p>
        <h2>Acceptable use</h2>
        <p>Do not upload illegal content or malware, attack the service, bypass access controls, send spam, abuse share links or APIs, or place unreasonable automated load on the service.</p>
        <h2>Backups and availability</h2>
        <p>We provide automatic backups and manual exports, but no online service can guarantee zero data loss. Download a full export regularly and keep it independently. Sync is not backup: mistakes and ransomware can propagate, backups cannot. The service is provided as-is; we do not promise uninterrupted availability.</p>
        <h2>Sharing</h2>
        <p>You are responsible for share links and their permissions. Public pages may be indexed; anyone with a link can access it according to its permission. Do not share sensitive content.</p>
        <h2>Deletion and termination</h2>
        <p>You can delete notes, empty trash or delete your account. Personal spaces are deleted; team spaces must transfer ownership first. Backups expire after the retention period. We may restrict access for serious violations. You can stop using the service and export your data at any time.</p>
        <h2>Liability</h2>
        <p>To the extent permitted by law, we are not liable for indirect, incidental, special or punitive damages arising from use or inability to use the service. When E2EE is not enabled, the server can technically access content for search, sharing and backups; we handle it only to provide the service.</p>
        <h2>Changes</h2>
        <p>We may update these terms. Material changes will be announced in-app. Continued use after changes means acceptance. If you disagree, stop using the service and export your data.</p>
      </div>
    </>
  );
}
