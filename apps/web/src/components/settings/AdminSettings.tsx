import { useEffect, useState } from 'react';
import { Activity, Database, HardDrive, Save, Server, ShieldCheck, Users } from 'lucide-react';
import type { AuditEntry } from '@360note/shared';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { formatBytes, formatFullDate, formatRelativeShort } from '../../lib/utils';
import { toast } from '../../stores/toast';

interface Stats {
  users: number;
  workspaces: number;
  notes: number;
  attachments: number;
  storageBytes: number;
  activeShares: number;
}

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function AdminSettings() {
  const t = useT();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [instance, setInstance] = useState<{ version: string; registrationMode: string; aiEnabled: boolean; ocrEnabled: boolean; backupRetentionDays: number } | null>(null);
  const [retention, setRetention] = useState(30);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ stats: Stats; instance: typeof instance }>('/api/admin/stats').then((res) => {
      setStats(res.stats);
      setInstance(res.instance as typeof instance);
      setRetention(res.instance?.backupRetentionDays ?? 30);
    }).catch(() => {});
    api.get<{ users: AdminUser[] }>('/api/admin/users').then((res) => setUsers(res.users)).catch(() => {});
    api.get<{ entries: AuditEntry[] }>('/api/admin/audit').then((res) => setAudit(res.entries)).catch(() => {});
  }, []);

  async function saveRetention() {
    setSaving(true);
    try {
      await api.put('/api/admin/settings', { backup: { retentionDays: retention } });
      toast('success', t('设置已保存'));
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1 className="settings-title">{t('实例管理')}</h1>
      <p className="settings-subtitle">{t('实例级的统计、用户、备份保留与审计。只有实例管理员可见。')}</p>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('运行概况')}</span>
          <span className="settings-section-desc">v{instance?.version ?? '—'}</span>
        </div>
        <div className="admin-stats">
          {[
            { icon: <Users size={15} />, value: stats?.users ?? 0, label: t('用户') },
            { icon: <Database size={15} />, value: stats?.notes ?? 0, label: t('笔记') },
            { icon: <HardDrive size={15} />, value: stats ? formatBytes(stats.storageBytes) : '—', label: t('附件存储') },
            { icon: <Activity size={15} />, value: stats?.activeShares ?? 0, label: t('有效分享') },
            { icon: <Server size={15} />, value: stats?.workspaces ?? 0, label: t('工作区') },
            { icon: <ShieldCheck size={15} />, value: stats?.attachments ?? 0, label: t('附件') },
          ].map((item) => (
            <div className="setting-card" key={item.label}>
              <span style={{ color: 'var(--text-tertiary)' }}>{item.icon}</span>
              <div className="admin-stat-value">{item.value}</div>
              <div className="setting-note">{item.label}</div>
            </div>
          ))}
        </div>
        <div className="setting-card" style={{ marginTop: 8, display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-tertiary)' }}>
          <span>{t('注册模式')}：<strong style={{ color: 'var(--text-secondary)' }}>{instance?.registrationMode ?? '—'}</strong></span>
          <span>{t('OCR')}：<strong style={{ color: 'var(--text-secondary)' }}>{instance?.ocrEnabled ? t('开启') : t('关闭')}</strong></span>
          <span>{t('AI')}：<strong style={{ color: 'var(--text-secondary)' }}>{instance?.aiEnabled ? t('开启') : t('关闭')}</strong></span>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('备份保留')}</span>
        </div>
        <div className="setting-inline-form">
          <div className="field" style={{ maxWidth: 200 }}>
            <label>{t('保留天数')}</label>
            <input className="input" type="number" min={1} max={3650} value={retention} onChange={(event) => setRetention(Number(event.target.value))} />
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={saveRetention} disabled={saving}>
            {saving ? <span className="spinner" /> : <Save size={13} />} {t('保存')}
          </button>
        </div>
        <p className="setting-note" style={{ marginTop: 6 }}>{t('自动备份保留 14 份；超过保留天数的备份会被清理。')}</p>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('用户')}</span>
          <span className="settings-section-desc">{users.length}</span>
        </div>
        <div className="setting-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr><th>{t('邮箱')}</th><th>{t('昵称')}</th><th>{t('角色')}</th><th>2FA</th><th>{t('最后登录')}</th></tr></thead>
            <tbody>
              {users.map((member) => (
                <tr key={member.id}>
                  <td><strong>{member.email}</strong></td>
                  <td>{member.displayName}</td>
                  <td><span className="badge">{member.role}</span></td>
                  <td>{member.totpEnabled ? <span className="badge badge-green">{t('开启')}</span> : <span className="badge">{t('关闭')}</span>}</td>
                  <td>{member.lastLoginAt ? formatRelativeShort(member.lastLoginAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('全局审计')}</span>
          <span className="settings-section-desc">{t('最近 200 条')}</span>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)' }}>
          {audit.slice(0, 60).map((entry) => (
            <div key={entry.id} style={{ display: 'flex', gap: 10, padding: '8px 10px', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
              <span style={{ width: 130, flex: 'none', color: 'var(--text-tertiary)' }}>{formatFullDate(entry.createdAt)}</span>
              <span style={{ width: 90, flex: 'none', color: 'var(--text-secondary)' }}>{entry.actorName ?? t('系统')}</span>
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{entry.action}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>{entry.ip}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
