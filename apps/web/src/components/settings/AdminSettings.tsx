import { useEffect, useState } from 'react';
import { Activity, Ban, Cloud, CloudUpload, Database, Download, HardDrive, LogOut, MoreHorizontal, Save, Server, Share2, ShieldCheck, Trash2, UserCheck, Users } from 'lucide-react';
import type { AuditEntry } from '@360note/shared';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { auditActionLabel } from '../../lib/audit';
import { cn, formatBytes, formatFullDate, formatRelativeShort } from '../../lib/utils';
import { toast } from '../../stores/toast';
import { Dropdown, MenuItem } from '../Dropdown';
import { ConfirmDialog } from '../Modal';
import { OffsiteSettings } from './OffsiteSettings';
import { useAuthStore } from '../../stores/auth';
import { LoadFailure } from '../LoadFailure';

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

interface AttachmentStorageStats {
  localBytes: number;
  localFiles: number;
  localAttachments: number;
  remoteAttachments: number;
  attachmentsEnabled: boolean;
  offsiteEnabled: boolean;
}

interface OffsiteUsage {
  local: { files: number; bytes: number; attachments: number };
  remote: { available: boolean; total: { objects: number; bytes: number }; attachments: { objects: number; bytes: number }; backups: { objects: number; bytes: number } } | null;
  attachmentsEnabled: boolean;
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
  const [attachmentStorage, setAttachmentStorage] = useState<AttachmentStorageStats | null>(null);
  const [offsiteUsage, setOffsiteUsage] = useState<OffsiteUsage | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [ipBlocks, setIpBlocks] = useState<Array<{ id: string; ip: string; reason: string | null; createdAt: string }>>([]);
  const [shares, setShares] = useState<Array<{ id: string; workspaceName: string; ownerName: string | null; permission: string; hasPassword: boolean; expiresAt: string | null; viewCount: number; url: string }>>([]);
  const [sharesTotal, setSharesTotal] = useState(0);
  const [sharesOffset, setSharesOffset] = useState(0);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [publicComments, setPublicComments] = useState<Array<{ id: string; noteId: string; noteTitle: string; authorName: string; body: string; ip: string | null; createdAt: string }>>([]);
  const [commentsTotal, setCommentsTotal] = useState(0);
  const [commentsOffset, setCommentsOffset] = useState(0);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [blockIp, setBlockIp] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [instance, setInstance] = useState<{ version: string; registrationMode: string; aiEnabled: boolean; ocrEnabled: boolean; backupRetentionDays: number } | null>(null);
  const [runtime, setRuntime] = useState<{ uptimeSeconds: number; memoryBytes: number; nodeVersion: string } | null>(null);
  const [retention, setRetention] = useState(30);
  const [saving, setSaving] = useState(false);
  const [adminTab, setAdminTab] = useState<'overview' | 'storage' | 'users' | 'shares' | 'comments' | 'logs'>('overview');
  const [instanceBackups, setInstanceBackups] = useState<Array<{ id: string; filename: string; size: number; offsiteStatus: string; offsiteError: string | null; createdAt: string }>>([]);
  const [instanceBackupSettings, setInstanceBackupSettings] = useState({ enabled: false, frequencyHours: 24, retentionCount: 7, drillEnabled: true, drillFrequencyHours: 24, lastDrillAt: null as string | null, lastDrillOk: null as boolean | null, lastDrillError: null as string | null, lastDrillBackup: null as string | null });
  const [instanceBackupBusy, setInstanceBackupBusy] = useState(false);
  const [drillBusy, setDrillBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [deleteComment, setDeleteComment] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ stats: Stats; instance: typeof instance; runtime: typeof runtime; attachmentStorage: AttachmentStorageStats }>('/api/admin/stats').then((res) => {
      setStats(res.stats);
      setInstance(res.instance as typeof instance);
      setRuntime(res.runtime as typeof runtime);
      setAttachmentStorage(res.attachmentStorage);
      setRetention(res.instance?.backupRetentionDays ?? 30);
      setPageError(null);
    }).catch((error: Error) => setPageError(error.message));
    void refreshOffsiteUsage();
    api.get<{ users: AdminUser[] }>('/api/admin/users').then((res) => setUsers(res.users)).catch((error: Error) => setPageError(error.message));
    void loadAudit(0);
    void refreshIpBlocks();
    void refreshInstanceBackups();
    void loadShares(0);
    void loadPublicComments(0);
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

  async function refreshOffsiteUsage() {
    try {
      const response = await api.get<OffsiteUsage>('/api/admin/offsite/usage');
      setOffsiteUsage(response);
    } catch (error) {
      setPageError((error as Error).message);
    }
  }

  async function refreshInstanceBackups() {
    try {
      const response = await api.get<{ backups: Array<{ id: string; filename: string; size: number; offsiteStatus: string; offsiteError: string | null; createdAt: string }>; settings: typeof instanceBackupSettings }>('/api/admin/instance-backups');
      setInstanceBackups(response.backups);
      setInstanceBackupSettings(response.settings);
    } catch (error) {
      setPageError((error as Error).message);
    }
  }

  async function saveInstanceBackupSettings() {
    try {
      await api.put('/api/admin/settings', { instanceBackup: instanceBackupSettings });
      await refreshInstanceBackups();
      toast('success', t('设置已保存'));
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
    }
  }

  async function createInstanceBackup() {
    setInstanceBackupBusy(true);
    try {
      await api.post('/api/admin/instance-backups');
      await Promise.all([refreshInstanceBackups(), refreshOffsiteUsage()]);
      toast('success', t('整站备份已创建'));
    } catch (error) {
      toast('error', t('备份失败'), (error as Error).message);
    } finally {
      setInstanceBackupBusy(false);
    }
  }

  async function retryInstanceBackupUpload(id: string) {
    try {
      await api.post(`/api/admin/instance-backups/${id}/upload`);
      await Promise.all([refreshInstanceBackups(), refreshOffsiteUsage()]);
      toast('success', t('已上传到对象存储'));
    } catch (error) {
      toast('error', t('上传失败'), (error as Error).message);
    }
  }

  async function runRestoreDrill() {
    setDrillBusy(true);
    try {
      const response = await api.post<{ settings: typeof instanceBackupSettings }>('/api/admin/instance-backups/drill');
      setInstanceBackupSettings(response.settings);
      toast('success', t('恢复演练通过'), t('数据库导出与附件均可解密读取。'));
    } catch (error) {
      await refreshInstanceBackups();
      toast('error', t('恢复演练失败'), (error as Error).message);
    } finally {
      setDrillBusy(false);
    }
  }

  async function removeInstanceBackup(id: string) {
    try {
      await api.delete(`/api/admin/instance-backups/${id}`);
      await Promise.all([refreshInstanceBackups(), refreshOffsiteUsage()]);
    } catch (error) {
      toast('error', t('删除失败'), (error as Error).message);
    }
  }

  async function loadShares(offset: number) {
    setSharesLoading(true);
    try {
      const response = await api.get<{ shares: typeof shares; total: number }>(`/api/admin/shares?limit=50&offset=${offset}`);
      setShares(response.shares);
      setSharesTotal(response.total);
      setSharesOffset(offset);
    } catch (error) {
      toast('error', t('加载失败'), (error as Error).message);
    } finally {
      setSharesLoading(false);
    }
  }

  async function loadPublicComments(offset: number) {
    setCommentsLoading(true);
    try {
      const response = await api.get<{ comments: typeof publicComments; total: number }>(`/api/admin/comments?limit=50&offset=${offset}`);
      setPublicComments(response.comments);
      setCommentsTotal(response.total);
      setCommentsOffset(offset);
    } catch (error) {
      toast('error', t('加载失败'), (error as Error).message);
    } finally {
      setCommentsLoading(false);
    }
  }

  async function deletePublicComment() {
    if (!deleteComment) return;
    try {
      await api.delete(`/api/admin/comments/${deleteComment}`);
      setDeleteComment(null);
      await loadPublicComments(commentsOffset);
      toast('success', t('评论已删除'));
    } catch (error) {
      toast('error', t('删除评论失败'), (error as Error).message);
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
      <p className="settings-subtitle">{t('实例级的统计、存储、用户、备份保留与审计。只有实例管理员可见。')}</p>

      {pageError && <LoadFailure message={pageError} onRetry={() => window.location.reload()} />}

      <div className="admin-tabs">
        {([
          ['overview', t('概览')],
          ['storage', t('存储管理')],
          ['users', t('用户管理')],
          ['shares', t('公开链接')],
          ['comments', t('公开评论')],
          ['logs', t('操作日志')],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={cn('admin-tab', adminTab === id && 'active')} onClick={() => setAdminTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {adminTab === 'storage' && (
        <div className="admin-storage-panel">
          <OffsiteSettings />
        </div>
      )}

      <section className="settings-section" hidden={adminTab !== 'overview'}>
        <div className="settings-section-head">
          <span className="settings-section-title">{t('运行概况')}</span>
          <span className="settings-section-desc">v{instance?.version ?? '—'}</span>
        </div>
        <div className="admin-stats">
          {[
            { icon: <Users size={15} />, value: stats?.users ?? 0, label: t('用户') },
            { icon: <Database size={15} />, value: stats?.notes ?? 0, label: t('笔记') },
            { icon: <HardDrive size={15} />, value: stats ? formatBytes(stats.storageBytes) : '—', label: t('附件数据量') },
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

      <section className="settings-section" hidden={adminTab !== 'overview'}>
        <div className="settings-section-head">
          <span className="settings-section-title">{t('附件存储')}</span>
          <span className="settings-section-desc">{attachmentStorage?.attachmentsEnabled ? t('对象存储') : t('本机')}</span>
        </div>
        <div className="admin-stats">
          <div className="setting-card">
            <span style={{ color: 'var(--text-tertiary)' }}><HardDrive size={15} /></span>
            <div className="admin-stat-value">{formatBytes(offsiteUsage?.local.bytes ?? attachmentStorage?.localBytes ?? 0)}</div>
            <div className="setting-note">{t('本机附件占用')} · {offsiteUsage?.local.files ?? attachmentStorage?.localFiles ?? 0} {t('个文件')}</div>
          </div>
          <div className="setting-card">
            <span style={{ color: 'var(--text-tertiary)' }}><Cloud size={15} /></span>
            <div className="admin-stat-value">{formatBytes(offsiteUsage?.remote?.attachments.bytes ?? 0)}</div>
            <div className="setting-note">{t('对象存储附件')} · {offsiteUsage?.remote?.attachments.objects ?? 0} {t('个对象')}</div>
          </div>
          <div className="setting-card">
            <span style={{ color: 'var(--text-tertiary)' }}><CloudUpload size={15} /></span>
            <div className="admin-stat-value">{formatBytes(offsiteUsage?.remote?.backups.bytes ?? 0)}</div>
            <div className="setting-note">{t('对象存储备份')} · {offsiteUsage?.remote?.backups.objects ?? 0} {t('个对象')}</div>
          </div>
        </div>
        <p className="setting-note" style={{ marginTop: 6 }}>
          {t('本机附件与对象存储附件分开统计；切换存储不会改变附件链接。可在“存储管理”中启用、停用并迁移。')}
        </p>
      </section>

      <section className="settings-section" hidden={adminTab !== 'overview'}>
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

      <section className="settings-section" hidden={adminTab !== 'overview'}>
        <div className="settings-section-head">
          <span className="settings-section-title">{t('整站备份')}</span>
          <span className="settings-section-desc">{instanceBackups.length}</span>
        </div>
        <p className="setting-note">{t('整站备份包含数据库导出和加密附件，用于灾难恢复。下载文件为 .3nb，需要主密钥才能恢复。')}</p>
        <p className="setting-note">{t('启用“异地备份与对象存储”中的备份副本后，整站备份会自动上传，失败可在下方重试。')}</p>
        <div className="setting-inline-form" style={{ marginTop: 10 }}>
          <label className="checkbox-row" style={{ margin: 0 }}>
            <input type="checkbox" checked={instanceBackupSettings.enabled} onChange={(event) => setInstanceBackupSettings((value) => ({ ...value, enabled: event.target.checked }))} />
            <span>{t('自动整站备份')}</span>
          </label>
          <div className="field field-role"><label>{t('频率（小时）')}</label><input className="input" type="number" min={1} max={720} value={instanceBackupSettings.frequencyHours} onChange={(event) => setInstanceBackupSettings((value) => ({ ...value, frequencyHours: Number(event.target.value) }))} /></div>
          <div className="field field-role"><label>{t('保留份数')}</label><input className="input" type="number" min={1} max={365} value={instanceBackupSettings.retentionCount} onChange={(event) => setInstanceBackupSettings((value) => ({ ...value, retentionCount: Number(event.target.value) }))} /></div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void saveInstanceBackupSettings()}>{t('保存')}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void createInstanceBackup()} disabled={instanceBackupBusy}>{instanceBackupBusy ? <span className="spinner" /> : <Database size={13} />} {t('立即备份整站')}</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void runRestoreDrill()} disabled={drillBusy}>{drillBusy ? <span className="spinner" /> : <ShieldCheck size={13} />} {t('立即演练')}</button>
        </div>
        <div className="setting-inline-form" style={{ marginTop: 8 }}>
          <label className="checkbox-row" style={{ margin: 0 }}>
            <input type="checkbox" checked={instanceBackupSettings.drillEnabled} onChange={(event) => setInstanceBackupSettings((value) => ({ ...value, drillEnabled: event.target.checked }))} />
            <span>{t('自动恢复演练')}</span>
          </label>
          <div className="field field-role"><label>{t('演练频率（小时）')}</label><input className="input" type="number" min={1} max={720} value={instanceBackupSettings.drillFrequencyHours} onChange={(event) => setInstanceBackupSettings((value) => ({ ...value, drillFrequencyHours: Number(event.target.value) }))} /></div>
          <span className={`badge ${instanceBackupSettings.lastDrillOk === true ? 'badge-green' : instanceBackupSettings.lastDrillOk === false ? 'badge-red' : 'badge-gray'}`}>
            {instanceBackupSettings.lastDrillAt
              ? `${instanceBackupSettings.lastDrillOk ? t('演练通过') : t('演练失败')} · ${formatRelativeShort(instanceBackupSettings.lastDrillAt)}`
              : t('尚未演练')}
          </span>
        </div>
        {instanceBackupSettings.lastDrillError && <div className="form-error" style={{ marginTop: 8 }}>{instanceBackupSettings.lastDrillError}</div>}
        <div className="admin-ip-list" style={{ marginTop: 10 }}>
          {instanceBackups.length === 0 ? <div className="context-empty">{t('暂无整站备份')}</div> : instanceBackups.map((backup) => (
            <div className="admin-ip-row" key={backup.id}>
              <span className="mono" title={backup.filename}>{backup.filename}</span>
              <span>
                {formatBytes(backup.size)} · {formatRelativeShort(backup.createdAt)}
                {backup.offsiteStatus === 'uploaded' && <span className="badge badge-green" style={{ marginLeft: 6 }}><Cloud size={10} /> S3</span>}
                {backup.offsiteStatus === 'failed' && <span className="badge badge-red" style={{ marginLeft: 6 }} title={backup.offsiteError ?? ''}>{t('上传失败')}</span>}
                {backup.offsiteStatus === 'skipped' && <span className="badge badge-gray" style={{ marginLeft: 6 }}>{t('仅本机')}</span>}
              </span>
              <span style={{ display: 'flex', gap: 4 }}>
                {backup.offsiteStatus === 'failed' && <button type="button" className="icon-btn icon-btn-sm" onClick={() => void retryInstanceBackupUpload(backup.id)} aria-label={t('重试上传')} title={t('重试上传')}><CloudUpload size={13} /></button>}
                <a className="icon-btn icon-btn-sm" href={`/api/admin/instance-backups/${backup.id}/download`} aria-label={t('下载')}><Download size={13} /></a>
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => void removeInstanceBackup(backup.id)} aria-label={t('删除')}><Trash2 size={13} /></button>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section" hidden={adminTab !== 'users'}>
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
                    <Dropdown
                      width="auto"
                      trigger={
                        <button type="button" className="icon-btn icon-btn-sm" aria-label={t('更多操作')} title={t('更多操作')}>
                          <MoreHorizontal size={14} />
                        </button>
                      }
                    >
                      {(close) => (
                        <>
                          <MenuItem
                            icon={<Share2 size={14} />}
                            disabled={member.id === currentUser?.id || Boolean(member.disabledAt)}
                            onClick={() => { close(); void setRestriction(member, { sharingDisabled: !member.sharingDisabled }); }}
                          >
                            {member.sharingDisabled ? t('允许分享') : t('禁止分享')}
                          </MenuItem>
                          <MenuItem
                            icon={member.disabledAt ? <UserCheck size={14} /> : <Ban size={14} />}
                            danger={!member.disabledAt}
                            disabled={member.id === currentUser?.id}
                            onClick={() => { close(); void setRestriction(member, { disabled: !member.disabledAt }); }}
                          >
                            {member.disabledAt ? t('启用账号') : t('停用账号')}
                          </MenuItem>
                          <MenuItem
                            icon={<LogOut size={14} />}
                            disabled={member.sessionCount === 0 || member.id === currentUser?.id}
                            onClick={() => { close(); void revokeUserSessions(member); }}
                          >
                            {t('退出设备')}
                          </MenuItem>
                        </>
                      )}
                    </Dropdown>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="setting-note" style={{ marginTop: 8 }}>{t('管理员可以查看账户元数据、空间/笔记/附件数量、会话与审计日志，并可调整角色或强制退出设备。不会提供读取用户笔记正文的后门；正文只在其授权的空间内可访问。')}</p>
      </section>

      <section className="settings-section" hidden={adminTab !== 'shares'}>
        <div className="settings-section-head">
          <span className="settings-section-title">{t('分享链接')}</span>
          <span className="settings-section-desc">{t('共 {n} 条', { n: sharesTotal })}</span>
        </div>
        <p className="setting-note">{t('只展示已生成的有效分享链接，用于排查公开内容。点击链接即可打开；需要密码的链接仍需密码，管理员不能绕过。管理员不会看到笔记正文。')}</p>
        <div className="setting-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table admin-share-table">
            <thead>
              <tr>
                <th>{t('链接')}</th>
                <th>{t('用户')}</th>
                <th>{t('权限')}</th>
                <th>{t('类型')}</th>
                <th>{t('过期时间')}</th>
                <th>{t('次数')}</th>
              </tr>
            </thead>
            <tbody>
              {sharesLoading ? (
                <tr><td colSpan={6}><div className="loading-row"><span className="spinner" /> {t('加载中…')}</div></td></tr>
              ) : shares.length === 0 ? (
                <tr><td colSpan={6}><div className="context-empty">{t('暂无有效分享')}</div></td></tr>
              ) : shares.map((share) => (
                <tr key={share.id}>
                  <td><a className="admin-share-link" href={share.url} target="_blank" rel="noopener noreferrer" title={share.url}>{share.url}</a></td>
                  <td>{share.ownerName ?? '—'}</td>
                  <td>{share.permission === 'view' ? t('只读') : share.permission === 'edit' ? t('可编辑') : t('可评论')}</td>
                  <td>{share.hasPassword ? t('密码保护') : t('公开')}</td>
                  <td>{share.expiresAt ? formatFullDate(share.expiresAt) : t('永不过期')}</td>
                  <td>{share.viewCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-log-pager">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadShares(Math.max(0, sharesOffset - 50))} disabled={sharesLoading || sharesOffset === 0}>
            {t('上一页')}
          </button>
          <span className="setting-note">{t('第 {page} 页', { page: Math.floor(sharesOffset / 50) + 1 })}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadShares(sharesOffset + 50)} disabled={sharesLoading || sharesOffset + 50 >= sharesTotal}>
            {t('下一页')}
          </button>
        </div>
      </section>

      <section className="settings-section" hidden={adminTab !== 'users'}>
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

      <section className="settings-section" hidden={adminTab !== 'comments'}>
        <div className="settings-section-head">
          <span className="settings-section-title">{t('公开评论')}</span>
          <span className="settings-section-desc">{t('共 {n} 条', { n: commentsTotal })}</span>
        </div>
        <p className="setting-note">{t('显示公开分享页上的匿名评论。管理员可以删除滥用内容，但不能修改或冒充评论者。')}</p>
        <div className="setting-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table admin-comment-table">
            <thead><tr><th>{t('评论内容')}</th><th>{t('评论者')}</th><th>{t('被评论笔记')}</th><th>{t('时间')}</th><th>{t('操作')}</th></tr></thead>
            <tbody>
              {commentsLoading ? (
                <tr><td colSpan={5}><div className="loading-row"><span className="spinner" /> {t('加载中…')}</div></td></tr>
              ) : publicComments.length === 0 ? (
                <tr><td colSpan={5}><div className="context-empty">{t('暂无公开评论')}</div></td></tr>
              ) : publicComments.map((comment) => (
                <tr key={comment.id}>
                  <td><div className="admin-comment-body">{comment.body}</div></td>
                  <td>
                    <div>{comment.authorName}</div>
                    <div className="setting-note mono">{comment.ip ?? '—'}</div>
                  </td>
                  <td><div className="admin-comment-note">{comment.noteTitle || t('未命名笔记')}</div></td>
                  <td className="setting-note">{formatFullDate(comment.createdAt)}</td>
                  <td><button type="button" className="icon-btn icon-btn-sm" onClick={() => setDeleteComment(comment.id)} title={t('删除评论')} aria-label={t('删除评论')}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-log-pager">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadPublicComments(Math.max(0, commentsOffset - 50))} disabled={commentsLoading || commentsOffset === 0}>{t('上一页')}</button>
          <span className="setting-note">{t('第 {page} 页', { page: Math.floor(commentsOffset / 50) + 1 })}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadPublicComments(commentsOffset + 50)} disabled={commentsLoading || commentsOffset + 50 >= commentsTotal}>{t('下一页')}</button>
        </div>
      </section>

      <section className="settings-section" hidden={adminTab !== 'logs'}>
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

      <ConfirmDialog
        open={Boolean(deleteComment)}
        onClose={() => setDeleteComment(null)}
        onConfirm={() => void deletePublicComment()}
        title={t('删除公开评论')}
        description={t('删除这条公开评论？')}
        confirmLabel={t('删除')}
        danger
      />
    </>
  );
}
