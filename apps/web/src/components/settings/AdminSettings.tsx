import { useEffect, useState } from 'react';
import { Activity, Database, HardDrive, Save, Server, ShieldCheck, Users } from 'lucide-react';
import type { AuditEntry } from '@360note/shared';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { auditActionLabel } from '../../lib/audit';
import { formatBytes, formatFullDate, formatRelativeShort } from '../../lib/utils';
import { toast } from '../../stores/toast';
import { useAuthStore } from '../../stores/auth';

interface Stats {
  users: number;
  workspaces: number;
  notes: number;
  attachments: number;
  storageBytes: number;
  activeShares: number;
  activeSessions: number;
  pendingJobs: number;
  failedJobs: number;
  databaseBytes: number;
  lastBackupAt: string | null;
}

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  workspaceCount: number;
  noteCount: number;
  storageBytes: number;
  sessionCount: number;
}

export default function AdminSettings() {
  const t = useT();
  const currentUser = useAuthStore((state) => state.user);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [instance, setInstance] = useState<{ version: string; registrationMode: string; aiEnabled: boolean; ocrEnabled: boolean; backupRetentionDays: number } | null>(null);
  const [runtime, setRuntime] = useState<{ uptimeSeconds: number; memoryBytes: number; nodeVersion: string } | null>(null);
  const [retention, setRetention] = useState(30);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ stats: Stats; instance: typeof instance; runtime: typeof runtime }>('/api/admin/stats').then((res) => {
      setStats(res.stats);
      setInstance(res.instance as typeof instance);
      setRuntime(res.runtime as typeof runtime);
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

  async function refreshUsers() {
    const response = await api.get<{ users: AdminUser[] }>('/api/admin/users');
    setUsers(response.users);
  }

  async function changeRole(member: AdminUser, role: 'user' | 'admin') {
    try {
      await api.patch(`/api/admin/users/${member.id}/role`, { role });
      await refreshUsers();
      toast('success', t('角色已更新'));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    }
  }

  async function revokeUserSessions(member: AdminUser) {
    try {
      await api.post(`/api/admin/users/${member.id}/revoke-sessions`);
      await refreshUsers();
      toast('success', t('已退出该用户的全部设备'));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
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
            { icon: <Server size={15} />, value: stats?.workspaces ?? 0, label: t('空间') },
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
          <span>{t('注册模式')}：<strong style={{ color: 'var(--text-secondary)' }}>{instance?.registrationMode === 'invite' ? t('仅邀请') : t('开放')}</strong></span>
          <span>OCR：<strong style={{ color: 'var(--text-secondary)' }}>{instance?.ocrEnabled ? t('已启用') : t('未启用')}</strong></span>
          <span>AI：<strong style={{ color: 'var(--text-secondary)' }}>{instance?.aiEnabled ? t('已启用') : t('未启用')}</strong></span>
        </div>
        <div className="admin-runtime">
          <span>{t('运行时间')} <strong>{runtime ? `${Math.floor(runtime.uptimeSeconds / 3600)}h ${Math.floor((runtime.uptimeSeconds % 3600) / 60)}m` : '—'}</strong></span>
          <span>{t('进程内存')} <strong>{runtime ? formatBytes(runtime.memoryBytes) : '—'}</strong></span>
          <span>{t('数据库大小')} <strong>{stats ? formatBytes(stats.databaseBytes) : '—'}</strong></span>
          <span>{t('活动会话')} <strong>{stats?.activeSessions ?? 0}</strong></span>
          <span>{t('待处理任务')} <strong>{stats?.pendingJobs ?? 0}</strong></span>
          <span>{t('24h 失败任务')} <strong style={{ color: (stats?.failedJobs ?? 0) > 0 ? 'var(--red)' : undefined }}>{stats?.failedJobs ?? 0}</strong></span>
          <span>{t('最近备份')} <strong>{stats?.lastBackupAt ? formatRelativeShort(stats.lastBackupAt) : '—'}</strong></span>
          <span>{t('Node')} <strong>{runtime?.nodeVersion ?? '—'}</strong></span>
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
          <table className="data-table admin-users-table">
            <thead><tr><th>{t('邮箱')}</th><th>{t('昵称')}</th><th>{t('角色')}</th><th>{t('空间 / 笔记')}</th><th>{t('附件存储')}</th><th>{t('会话')}</th><th>{t('最后登录')}</th><th>{t('操作')}</th></tr></thead>
            <tbody>
              {users.map((member) => (
                <tr key={member.id}>
                  <td><strong>{member.email}</strong></td>
                  <td>{member.displayName}</td>
                  <td>
                    <select className="select select-sm" value={member.role} disabled={member.id === currentUser?.id} onChange={(event) => void changeRole(member, event.target.value as 'user' | 'admin')}>
                      <option value="user">{t('普通用户')}</option>
                      <option value="admin">{t('管理员')}</option>
                    </select>
                    {member.totpEnabled && <span className="badge badge-green" style={{ marginLeft: 5 }}>2FA</span>}
                  </td>
                  <td>{member.workspaceCount} / {member.noteCount}</td>
                  <td>{formatBytes(member.storageBytes)}</td>
                  <td>{member.sessionCount}</td>
                  <td>{member.lastLoginAt ? formatRelativeShort(member.lastLoginAt) : '—'}</td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void revokeUserSessions(member)} disabled={member.sessionCount === 0 || member.id === currentUser?.id}>
                      {t('退出设备')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="setting-note" style={{ marginTop: 8 }}>{t('管理员可以查看账户元数据、空间/笔记/附件数量、会话与审计日志，并可调整角色或强制退出设备。不会提供读取用户笔记正文的后门；正文只在其授权的空间内可访问。')}</p>
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
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{auditActionLabel(t, entry.action)}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>{entry.ip}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
