import { Link } from 'react-router-dom';
import { BookOpen, ExternalLink, Focus, Github, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { getLocale, useT } from '../../lib/i18n';

export default function AboutSettings() {
  const t = useT();
  const instance = useAuthStore((state) => state.instance);
  const user = useAuthStore((state) => state.user);
  const brand = getLocale() === 'zh-CN' ? '360笔记' : '360note';

  return (
    <>
      <h1 className="settings-title">{t('关于 360笔记')}</h1>
      <p className="settings-subtitle">{t('一个安静、快速、本地优先的笔记空间。记录、整理、发布，在同一条路径上完成。')}</p>

      <section className="settings-section">
        <div className="settings-section-head"><span className="settings-section-title">{t('构建版本')}</span></div>
        <div className="setting-card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontSize: 30, letterSpacing: '-0.03em' }}>{brand}</span>
            <span className="badge">v{instance?.version ?? '—'}</span>
          </div>
          <div className="setting-note" style={{ marginTop: 6 }}>
            {window.location.origin} · {t('账户')}: {user?.email}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <a className="btn btn-secondary btn-sm" href="https://github.com/widgeted/360note" target="_blank" rel="noreferrer">
              <Github size={13} /> {t('源代码')} <ExternalLink size={11} />
            </a>
            <Link to="/privacy" className="btn btn-secondary btn-sm"><ShieldCheck size={13} /> {t('隐私政策')}</Link>
            <Link to="/terms" className="btn btn-secondary btn-sm"><BookOpen size={13} /> {t('服务条款')}</Link>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head"><span className="settings-section-title">{t('设计原则')}</span></div>
        <div className="principles-grid" style={{ gridTemplateColumns: '1fr', border: 0, background: 'transparent', gap: 8 }}>
          <div className="setting-card">
            <Focus size={15} style={{ color: 'var(--blue)', marginBottom: 8 }} />
            <div className="setting-row-title">{t('一屏一个主任务')}</div>
            <p className="setting-note" style={{ marginTop: 4 }}>{t('写作时，管理操作退到背景；管理时，编辑控件让位。主界面只保留新建、搜索、列表、编辑器与保存状态。')}</p>
          </div>
          <div className="setting-card">
            <LockKeyhole size={15} style={{ color: 'var(--green)', marginBottom: 8 }} />
            <div className="setting-row-title">{t('数据属于你')}</div>
            <p className="setting-note" style={{ marginTop: 4 }}>{t('Markdown 为底，附件可单独下载，全库可导出为可重建的目录。同步与备份分离，备份可下载。')}</p>
          </div>
          <div className="setting-card">
            <ShieldCheck size={15} style={{ color: 'var(--violet)', marginBottom: 8 }} />
            <div className="setting-row-title">{t('安全透明')}</div>
            <p className="setting-note" style={{ marginTop: 4 }}>{t('TLS、scrypt 密码派生、AES-256-GCM 附件加密、可选 2FA、恢复密钥、审计日志。当前版本不提供 E2EE，并明确说明其取舍。')}</p>
          </div>
        </div>
      </section>

    </>
  );
}
