import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArchiveRestore,
  Check,
  CloudDownload,
  Download,
  HardDrive,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { BackupInfo, JobInfo } from '@360note/shared';
import { api } from '../../lib/api';
import { useAppStore } from '../../stores/app';
import { getLocale, useT } from '../../lib/i18n';
import { downloadBlob } from '../../lib/api';
import { formatBytes, formatFullDate, formatRelativeShort, sleep } from '../../lib/utils';
import { Modal } from '../Modal';
import { toast } from '../../stores/toast';

interface RestorePreview {
  format: string;
  version: number;
  createdAt: string;
  workspace: { id: string; name: string };
  counts: { notes: number; folders: number; tags: number; attachments: number; versions: number; comments: number };
  sameWorkspace: boolean;
  warnings: string[];
}

export function BackupPanel({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const t = useT();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<{ backupId?: string; uploadId?: string; preview: RestorePreview; filename?: string } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retention, setRetention] = useState<{ retentionDays: number; autoKeep: number } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load();
    api.get<{ retentionDays: number; autoKeep: number }>('/api/backups/retention').then(setRetention).catch(() => {});
  }, [workspaceId]);

  async function load() {
    setLoading(true);
    try {
      const response = await api.get<{ backups: BackupInfo[] }>(`/api/workspaces/${workspaceId}/backups`);
      setBackups(response.backups);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function pollJob(jobId: string, onProgress?: (job: JobInfo) => void): Promise<JobInfo> {
    for (let attempt = 0; attempt < 1200; attempt++) {
      await sleep(700);
      const response = await api.get<{ job: JobInfo }>(`/api/jobs/${jobId}`);
      onProgress?.(response.job);
      if (response.job.status === 'done' || response.job.status === 'error') return response.job;
    }
    throw new Error(t('任务超时'));
  }

  async function createBackup() {
    setCreating(true);
    setError(null);
    try {
      const response = await api.post<{ jobId: string }>(`/api/workspaces/${workspaceId}/backups`);
      const job = await pollJob(response.jobId);
      if (job.status === 'error') throw new Error(job.error ?? t('备份失败'));
      toast('success', t('备份已创建'));
      await load();
    } catch (error) {
      toast('error', t('备份失败'), (error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function download(backup: BackupInfo) {
    try {
      await downloadBlob(
        `/api/backups/${backup.id}/download?workspaceId=${workspaceId}`,
        backup.filename.replace(/\.(nhbackup|3nb)$/, '.3nb'),
      );
    } catch (error) {
      toast('error', t('下载失败'), (error as Error).message);
    }
  }

  async function remove(backup: BackupInfo) {
    if (revokeId !== backup.id) {
      setRevokeId(backup.id);
      return;
    }
    try {
      await api.delete(`/api/backups/${backup.id}?workspaceId=${workspaceId}`);
      setBackups((current) => current.filter((entry) => entry.id !== backup.id));
      setRevokeId(null);
      toast('success', t('备份已删除'));
    } catch (error) {
      toast('error', t('删除失败'), (error as Error).message);
    }
  }

  async function preview(backup: BackupInfo) {
    try {
      const response = await api.get<{ preview: RestorePreview }>(`/api/backups/${backup.id}/preview?workspaceId=${workspaceId}`);
      setMode(response.preview.sameWorkspace ? 'merge' : 'merge');
      setRestoreTarget({ backupId: backup.id, preview: response.preview, filename: backup.filename });
    } catch (error) {
      toast('error', t('无法读取备份'), (error as Error).message);
    }
  }

  async function uploadBackup(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const response = await api.upload<{ uploadId: string; preview: RestorePreview; filename: string }>(
        `/api/workspaces/${workspaceId}/backups/upload`,
        form,
      );
      setMode('merge');
      setRestoreTarget({ uploadId: response.uploadId, preview: response.preview, filename: response.filename });
    } catch (error) {
      toast('error', t('上传备份失败'), (error as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function restore() {
    if (!restoreTarget) return;
    setRestoring(true);
    setRestoreProgress(1);
    try {
      let jobId: string;
      if (restoreTarget.backupId) {
        const response = await api.post<{ jobId: string }>(
          `/api/backups/${restoreTarget.backupId}/restore?workspaceId=${workspaceId}`,
          { mode },
        );
        jobId = response.jobId;
      } else if (restoreTarget.uploadId) {
        const response = await api.post<{ jobId: string }>(
          `/api/backups/uploads/${restoreTarget.uploadId}/restore`,
          { mode },
        );
        jobId = response.jobId;
      } else {
        throw new Error(t('无法读取备份'));
      }
      const job = await pollJob(jobId, (current) => setRestoreProgress(current.progress));
      if (job.status === 'error') throw new Error(job.error ?? t('恢复失败'));
      toast('success', t('恢复完成'));
      setRestoreTarget(null);
      await useAppStore.getState().refreshAll();
      await useAppStore.getState().reloadNote();
      await load();
    } catch (error) {
      toast('error', t('恢复失败'), (error as Error).message);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={createBackup} disabled={creating || !canManage}>
          {creating ? <span className="spinner" /> : <Plus size={13} />} {t('立即备份')}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => uploadRef.current?.click()} disabled={uploading || !canManage}>
          {uploading ? <span className="spinner" /> : <UploadCloud size={13} />} {t('上传备份文件')}
        </button>
        <input ref={uploadRef} type="file" hidden accept=".3nb,.nhbackup,.zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadBackup(file); event.target.value = ''; }} />
        <div style={{ flex: 1 }} />
        <span className="setting-note">
          {getLocale() === 'en'
            ? `${backups.length} backup${backups.length === 1 ? '' : 's'}`
            : `${backups.length} ${t('份备份')}`}
        </span>
      </div>
      {!canManage && <div className="banner banner-warning" style={{ marginBottom: 12 }}><AlertCircle size={14} /><div>{t('只有空间管理员可以创建或恢复备份。你仍然可以导出整个空间。')}</div></div>}
      {error && <div className="form-error" style={{ marginBottom: 12 }}><AlertCircle size={14} /> {error}</div>}

      {loading ? (
        <div className="loading-row"><span className="spinner" /> {t('加载中…')}</div>
      ) : backups.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 20px' }}>
          <div className="empty-icon"><HardDrive size={18} /></div>
          <div className="empty-title">{t('没有备份')}</div>
          <div className="empty-text">{t('自动备份每天运行一次。你也可以立即创建一份并下载到独立位置。')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {backups.map((backup) => (
            <div key={backup.id} className="setting-card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 11 }}>
              <span style={{ color: backup.kind === 'pre-restore' ? 'var(--amber)' : 'var(--text-tertiary)' }}>
                {backup.kind === 'pre-restore' ? <RotateCcw size={15} /> : <CloudDownload size={15} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 560 }}>{backup.kind === 'auto' ? t('自动备份') : backup.kind === 'pre-restore' ? t('恢复前安全备份') : t('手动备份')}</span>
                  <span className="badge">{formatRelativeShort(backup.createdAt)}</span>
                  {backup.status === 'failed' && <span className="badge badge-red">{t('失败')}</span>}
                  {backup.offsite === 'uploaded' && <span className="badge badge-green">{t('异地已上传')}</span>}
                  {backup.offsite === 'failed' && <span className="badge badge-red">{t('异地上传失败')}</span>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 3 }}>
                  {formatFullDate(backup.createdAt)} · {t('{n} 篇笔记', { n: backup.noteCount })} · {t('{n} 个附件', { n: backup.attachmentCount })} · {formatBytes(backup.size)}
                </div>
              </div>
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => void preview(backup)} title={t('恢复预览')} aria-label={t('恢复预览')}>
                <ArchiveRestore size={14} />
              </button>
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => void download(backup)} title={t('下载')} aria-label={t('下载')}>
                <Download size={14} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={() => void remove(backup)}
                title={revokeId === backup.id ? t('再次点击确认') : t('删除')}
                aria-label={t('删除')}
                style={revokeId === backup.id ? { background: 'var(--red-soft)', color: 'var(--red)' } : undefined}
              >
                {revokeId === backup.id ? <Check size={14} /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="info-line" style={{ marginTop: 14 }}>
        <HardDrive size={13} />
        <span>
          {t('自动备份每天运行一次，保留 {n} 份每日副本，最多保留 {d} 天。备份包含笔记、文件夹、标签、历史版本、评论与附件；分享链接不会被恢复。', { n: retention?.autoKeep ?? 14, d: retention?.retentionDays ?? 30 })}
        </span>
      </div>
      <div className="info-line" style={{ marginTop: 6 }}>
        <AlertCircle size={13} />
        <span>{t('备份默认存储在同一台服务器上，已加密。管理员可配置 S3 兼容异地存储；仍建议定期下载一份到独立位置。')}</span>
      </div>

      <Modal
        open={Boolean(restoreTarget)}
        onClose={() => { if (!restoring) setRestoreTarget(null); }}
        title={t('恢复预览')}
        description={restoreTarget?.filename}
        size="md"
        closeOnOverlay={!restoring}
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRestoreTarget(null)} disabled={restoring}>{t('取消')}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={restore} disabled={restoring}>
              {restoring ? <span className="spinner" /> : <ArchiveRestore size={13} />} {t('确认恢复')}
            </button>
          </>
        }
      >
        {restoreTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="restore-counts" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div className="setting-card" style={{ padding: 11 }}><div style={{ fontSize: 22, fontFamily: 'var(--font-ui)' }}>{restoreTarget.preview.counts.notes}</div><div className="setting-note">{t('笔记')}</div></div>
              <div className="setting-card" style={{ padding: 11 }}><div style={{ fontSize: 22, fontFamily: 'var(--font-ui)' }}>{restoreTarget.preview.counts.attachments}</div><div className="setting-note">{t('附件')}</div></div>
              <div className="setting-card" style={{ padding: 11 }}><div style={{ fontSize: 22, fontFamily: 'var(--font-ui)' }}>{restoreTarget.preview.counts.folders}</div><div className="setting-note">{t('文件夹')}</div></div>
            </div>
            <div className="setting-note">
              {t('来自「{name}」，创建于 {date}', { name: restoreTarget.preview.workspace.name, date: formatFullDate(restoreTarget.preview.createdAt) })}
            </div>
            {restoreTarget.preview.warnings.map((warning) => (
              <div className="banner banner-warning" key={warning}><AlertCircle size={14} /><div>{warning}</div></div>
            ))}
            <div>
              <div className="context-section-title">{t('恢复方式')}</div>
              <div className="share-permission-list">
                <button type="button" className={`share-permission-option ${mode === 'merge' ? 'selected' : ''}`} onClick={() => setMode('merge')}>
                  <span className="share-permission-radio" />
                  <span><span className="share-permission-name">{t('合并为副本')}</span><span className="share-permission-desc">{t('创建新笔记并保留当前内容。更安全，不覆盖现有笔记。')}</span></span>
                </button>
                <button type="button" className={`share-permission-option ${mode === 'replace' ? 'selected' : ''}`} onClick={() => setMode('replace')} disabled={!restoreTarget.preview.sameWorkspace}>
                  <span className="share-permission-radio" />
                  <span><span className="share-permission-name">{t('替换当前空间')}</span><span className="share-permission-desc">{t('删除当前笔记后恢复到备份时间点。会先自动创建一份安全备份。')}</span></span>
                </button>
              </div>
              {mode === 'replace' && <div className="banner banner-error" style={{ marginTop: 8 }}><AlertCircle size={14} /><div>{t('替换会移除当前空间中的笔记与文件夹。恢复前会自动生成安全备份，但请确认你已下载需要保留的数据。')}</div></div>}
            </div>
            {restoring && (
              <div>
                <div className="setting-note" style={{ marginBottom: 6 }}>{t('正在恢复…')}</div>
                <div className="progress"><div className="progress-bar" style={{ width: `${restoreProgress}%` }} /></div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
