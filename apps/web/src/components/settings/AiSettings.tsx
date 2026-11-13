import { Check, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { useT } from '../../lib/i18n';

export default function AiSettings() {
  const t = useT();
  const instance = useAuthStore((state) => state.instance);

  return (
    <>
      <h1 className="settings-title">{t('AI 与隐私')}</h1>
      <p className="settings-subtitle">{t('AI 是可选的高级能力，默认关闭，不会自动弹窗，也不会在你不知情时读取笔记。')}</p>

      <div className="banner banner-info" style={{ marginBottom: 26 }}>
        <ShieldCheck size={15} />
        <div>
          <strong>{t('你的笔记不会被用于训练模型。')}</strong> {t('只有当你在单篇笔记中主动点击“AI 摘要”时，该篇内容才会发送给实例管理员配置的兼容服务。')}
        </div>
      </div>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('数据如何使用')}</span>
          <span className="settings-section-desc">{t('按需、最小范围')}</span>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('AI 数据政策')}</div>
            <div className="setting-row-desc">{t('不用于训练；不自动发送；不包含其他笔记；不包含账户密码或恢复密钥。加密笔记永远不会发送。')}</div>
          </div>
          <div className="setting-row-control"><span className="badge badge-green">{t('不训练')}</span></div>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('可随时关闭')}</div>
            <div className="setting-row-desc">{t('关闭后，AI 摘要入口会隐藏；360note 不会生成或保存摘要。')}</div>
          </div>
          <div className="setting-row-control">
            <span className={`badge ${instance?.aiEnabled ? 'badge-green' : ''}`}>{instance?.aiEnabled ? t('实例已启用') : t('实例未启用')}</span>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('影响范围')}</div>
            <div className="setting-row-desc">{t('AI 不参与同步、搜索索引、备份或分享。公开分享页面不会调用 AI。')}</div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('实例 AI 设置')}</span>
        </div>
        <div className="banner">
          <LockKeyhole size={15} />
          <div>{t('实例管理员可在“实例管理 → AI 服务”配置模型与密钥。普通用户只能看到当前实例是否启用。')}</div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head"><span className="settings-section-title">{t('摘要入口在哪里？')}</span></div>
        <div className="principles-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8, border: 0, background: 'transparent' }}>
          <div className="setting-card">
            <Sparkles size={15} style={{ color: 'var(--blue)', marginBottom: 8 }} />
            <div className="setting-row-title">{t('单篇笔记的“…”菜单')}</div>
            <p className="setting-note" style={{ marginTop: 4 }}>{t('不占用主界面，不自动弹出。需要时从单篇笔记的更多菜单中打开 AI 摘要。')}</p>
          </div>
          <div className="setting-card">
            <Check size={15} style={{ color: 'var(--green)', marginBottom: 8 }} />
            <div className="setting-row-title">{t('命令面板可搜索')}</div>
            <p className="setting-note" style={{ marginTop: 4 }}>{t('按 ⌘K 输入“摘要”即可定位，即使不记得它在哪个菜单。')}</p>
          </div>
        </div>
      </section>
    </>
  );
}
