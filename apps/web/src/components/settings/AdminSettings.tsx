import { useEffect, useState } from 'react';
import { Activity, Database, HardDrive, Save, Server, ShieldCheck, Users } from 'lucide-react';
import type { AuditEntry } from '@360note/shared';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { auditActionLabel } from '../../lib/audit';
import { cn, formatBytes, formatFullDate, formatRelativeShort } from '../../lib/utils';
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
  sharingDisabled: boolean;
  disabledAt: string | null;
}

export default function AdminSettings() {
  const t = useT();
  const currentUser = useAuthStore((state) => state.user);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [ipBlocks, setIpBlocks] = useState<Array<{ id: string; ip: string; reason: string | null; createdAt: string }>>([]);
  const [blockIp, setBlockIp] = useState('');
  const [blockReason, setBlockReason] = useState('');
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
    void loadAudit(0);
    void refreshIpBlocks();
  }, []);

  async function refreshIpBlocks() {
    const response = await api.get<{ blocks: Array<{ id: string; ip: string; reason: string | null; createdAt: string }> }>('/api/admin/ip-blocks');
    setIpBlocks(response.blocks);
  }

  async function addIpBlock() {
    if (!blockIp.trim()) return;
    try {
      await api.post('/api/admin/ip-blocks', { ip: blockIp.trim(), reason: blockReason.trim() || undefined });
      setBlockIp('');
      setBlockReason('');
      await refreshIpBlocks();
      toast('success', t('已加入注册限制'));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    }
  }

  async function removeIpBlock(id: string) {
    try {
      await api.delete(`/api/admin/ip-blocks/${id}`);
      await refreshIpBlocks();
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    }
  }

  async function setRestriction(member: AdminUser, patch: { sharingDisabled?: boolean; disabled?: boolean }) {
    try {
      await api.patch(`/api/admin/users/${member.id}/restrictions`, patch);
      await refreshUsers();
      toast('success', t('用户限制已更新'));
    } catch (error) {
      toast('error', t('操作失败'), (error as Error).message);
    }
  }

  async function loadAudit(offset: number) {
    setAuditLoading(true);
    try {
      const response = await api.get<{ entries: AuditEntry[]; total: number }>(`/api/admin/audit?limit=50&offset=${offset}`);
      setAudit(response.entries);
      setAuditTotal(response.total);
      setAuditOffset(offset);
    } catch (error) {
      toast('error', t('加载失败'), (error as Error).message);
    } finally {
      setAuditLoading(false);
    }
  }

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
                    {member.disabledAt && <span className="badge badge-red" style={{ marginLeft: 5 }}>{t('已停用')}</span>}
                  </td>
                  <td>{member.workspaceCount} / {member.noteCount}</td>
                  <td>{formatBytes(member.storageBytes)}</td>
                  <td>{member.sessionCount}</td>
                  <td>{member.lastLoginAt ? formatRelativeShort(member.lastLoginAt) : '—'}</td>
                  <td>
                    <div className="admin-user-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void setRestriction(member, { sharingDisabled: !member.sharingDisabled })} disabled={member.id === currentUser?.id || Boolean(member.disabledAt)}>
                        {member.sharingDisabled ? t('允许分享') : t('禁止分享')}
                      </button>
                      <button type="button" className={cn('btn btn-ghost btn-sm', member.disabledAt && 'btn-danger')} onClick={() => void setRestriction(member, { disabled: !member.disabledAt })} disabled={member.id === currentUser?.id}>
                        {member.disabledAt ? t('启用账号') : t('停用账号')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void revokeUserSessions(member)} disabled={member.sessionCount === 0 || member.id === currentUser?.id}>
                        {t('退出设备')}
                      </button>
                    </div>
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
          <span className="settings-section-title">{t('注册 IP 限制')}</span>
          <span className="settings-section-desc">{ipBlocks.length}</span>
        </div>
        <p className="setting-note">{t('禁止这些 IP 注册新账号。已有账号的登录不受影响；邮箱可以更换，网络限制更直接。')}</p>
        <div className="setting-inline-form" style={{ marginTop: 10 }}>
          <div className="field"><label>IP</label><input className="input" value={blockIp} onChange={(event) => setBlockIp(event.target.value)} placeholder="203.0.113.10" /></div>
          <div className="field"><label>{t('原因（可选）')}</label><input className="input" value={blockReason} onChange={(event) => setBlockReason(event.target.value)} /></div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void addIpBlock()} disabled={!blockIp.trim()}>{t('添加限制')}</button>
        </div>
        <div className="admin-ip-list">
          {ipBlocks.length === 0 ? <div className="context-empty">{t('暂无 IP 限制')}</div> : ipBlocks.map((block) => (
            <div className="admin-ip-row" key={block.id}>
              <span className="mono">{block.ip}</span>
              <span>{block.reason || '—'}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeIpBlock(block.id)}>{t('解除')}</button>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('日志')}</span>
          <span className="settings-section-desc">{t('共 {n} 条', { n: auditTotal })}</span>
        </div>
        <div className="admin-log-list">
          {auditLoading ? (
            <div className="loading-row"><span className="spinner" /> {t('加载中…')}</div>
          ) : audit.length === 0 ? (
            <div className="context-empty">{t('暂无记录')}</div>
          ) : (
            audit.map((entry) => (
              <div key={entry.id} className="admin-log-row">
                <span className="admin-log-time">{formatFullDate(entry.createdAt)}</span>
                <span className="admin-log-actor" title={entry.actorName ?? t('系统')}>{entry.actorName ?? t('系统')}</span>
                <span className="admin-log-action">{auditActionLabel(t, entry.action)}</span>
                <span className="admin-log-ip" title={entry.ip ?? ''}>{entry.ip ?? '—'}</span>
              </div>
            ))
          )}
        </div>
        <div className="admin-log-pager">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadAudit(Math.max(0, auditOffset - 50))} disabled={auditLoading || auditOffset === 0}>
            {t('上一页')}
          </button>
          <span className="setting-note">
            {t('第 {page} 页', { page: Math.floor(auditOffset / 50) + 1 })}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadAudit(auditOffset + 50)} disabled={auditLoading || auditOffset + 50 >= auditTotal}>
            {t('下一页')}
          </button>
        </div>
      </section>
    </>
  );
}
