import { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, CloudDownload, CloudUpload, Download, HardDrive, PlugZap, RefreshCw, Save, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useT } from '../../lib/i18n';
import { toast } from '../../stores/toast';
import { formatBytes, formatRelativeShort } from '../../lib/utils';
import { LoadFailure } from '../LoadFailure';
import { ConfirmDialog } from '../Modal';

interface OffsiteConfig {
  enabled: boolean;
  attachmentsEnabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  hasSecret: boolean;
  forcePathStyle: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
}

interface AttachmentStorageConfig {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  hasSecret: boolean;
  forcePathStyle: boolean;
  mediaBaseUrl: string;
  hasCdnAuthKey: boolean;
  mediaPrefix: string;
  imageFormat: 'auto' | 'webp' | 'jpg';
  imageQuality: number;
  imageMaxWidth: number;
  imageTags: 'off' | 'suggest' | 'auto';
  detectFunctionalImages: boolean;
  legacy: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
}

interface UsageValue {
  objects: number;
  bytes: number;
}

interface StorageUsage {
  enabled: boolean;
  attachmentsEnabled: boolean;
  configured: boolean;
  local: { files: number; bytes: number; attachments: number };
  remote: {
    available: boolean;
    error?: string;
    total: UsageValue;
    attachments: UsageValue;
    backups: UsageValue;
    attachmentsCount: number;
  } | null;
  migration: {
    phase: 'idle' | 'enabling' | 'disabling' | 'purging';
    running: boolean;
    processed: number;
    total: number;
    failed: number;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    message: string | null;
  };
}

export function OffsiteSettings() {
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const [config, setConfig] = useState<OffsiteConfig | null>(null);
  const [attachmentConfig, setAttachmentConfig] = useState<AttachmentStorageConfig | null>(null);
  const [attachmentSecret, setAttachmentSecret] = useState('');
  const [attachmentCdnKey, setAttachmentCdnKey] = useState('');
  const [attachmentSaving, setAttachmentSaving] = useState(false);
  const [attachmentTesting, setAttachmentTesting] = useState(false);
  const [backupEditing, setBackupEditing] = useState(false);
  const [attachmentEditing, setAttachmentEditing] = useState(false);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [objects, setObjects] = useState<Array<{ key: string; size: number; lastModified: string | null; kind: string }>>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [verifyState, setVerifyState] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreKey, setRestoreKey] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [purgeRemote, setPurgeRemote] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [objectQuery, setObjectQuery] = useState('');
  const pollRef = useRef<number | null>(null);

  const loadUsage = useCallback(async (force = false) => {
    try {
      const response = await api.get<StorageUsage>(`/api/admin/offsite/usage${force ? '?force=1' : ''}`);
      setUsage(response);
      setPageError(null);
      return response;
    } catch (error) {
      setPageError((error as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    api.get<{ offsite: OffsiteConfig }>('/api/admin/offsite').then((res) => setConfig(res.offsite)).catch((error: Error) => setPageError(error.message));
    api.get<{ attachmentStorage: AttachmentStorageConfig }>('/api/admin/attachment-storage').then((res) => setAttachmentConfig(res.attachmentStorage)).catch((error: Error) => setPageError(error.message));
    void loadUsage(true);
    void loadObjects();
  }, [user?.role, loadUsage]);

  useEffect(() => {
    if (!usage?.migration.running) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setMigrating(false);
      return;
    }
    setMigrating(true);
    if (pollRef.current) return;
    pollRef.current = window.setInterval(() => {
      void (async () => {
        const next = await loadUsage(true);
        if (!next) return;
        if (!next.migration.running) {
          setMigrating(false);
          if (next.migration.error) {
            toast('error', t('附件迁移失败'), next.migration.error);
          } else if (next.migration.message) {
            toast('success', t('附件迁移完成'), next.migration.message);
          }
          api.get<{ offsite: OffsiteConfig }>('/api/admin/offsite').then((res) => setConfig(res.offsite)).catch(() => {});
        }
      })();
    }, 1500);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [usage?.migration.running, loadUsage, t]);

  if (user?.role !== 'admin') return null;

  async function loadObjects() {
    setObjectsLoading(true);
    try {
      const response = await api.get<{ objects: Array<{ key: string; size: number; lastModified: string | null; kind: string }> }>('/api/admin/offsite/objects?limit=200');
      setObjects(response.objects);
      setObjectsError(null);
    } catch (error) {
      setObjectsError((error as Error).message);
    } finally {
      setObjectsLoading(false);
    }
  }

  async function verifyObject(key: string) {
    try {
      const result = await api.post<{ kind: string; bytes?: number; counts?: { notes: number; attachments: number } }>('/api/admin/offsite/objects/verify', { key });
      setVerifyState((current) => ({
        ...current,
        [key]: {
          ok: true,
          text: result.kind === 'workspace-backup'
            ? t('校验通过 · {notes} 篇笔记 / {attachments} 个附件', { notes: result.counts?.notes ?? 0, attachments: result.counts?.attachments ?? 0 })
            : t('校验通过 · {size}', { size: formatBytes(result.bytes ?? 0) }),
        },
      }));
    } catch (error) {
      setVerifyState((current) => ({ ...current, [key]: { ok: false, text: (error as Error).message } }));
    }
  }

  async function restoreObject(key: string) {
    setRestoring(key);
    try {
      const response = await api.post<{ jobId: string }>('/api/admin/offsite/objects/restore', { key, mode: 'merge' });
      for (let i = 0; i < 240; i++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const job = await api.get<{ job: { status: string; error: string | null } }>(`/api/jobs/${response.jobId}`);
        if (job.job.status === 'done') {
          toast('success', t('备份已恢复为副本'), t('新的副本会显示在对应工作区的笔记列表中。'));
          return;
        }
        if (job.job.status === 'error') throw new Error(job.job.error || t('恢复失败'));
      }
      throw new Error(t('恢复超时，请稍后在任务列表查看'));
    } catch (error) {
      toast('error', t('恢复失败'), (error as Error).message);
    } finally {
      setRestoring(null);
    }
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const response = await api.put<{ offsite: OffsiteConfig }>('/api/admin/offsite', {
        ...config,
        secretAccessKey: secret || undefined,
      });
      setConfig(response.offsite);
      setSecret('');
      setBackupEditing(false);
      await loadUsage(true);
      toast('success', t('设置已保存'));
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      await api.post('/api/admin/offsite/test');
      toast('success', t('S3 连接成功'));
      const res = await api.get<{ offsite: OffsiteConfig }>('/api/admin/offsite');
      setConfig(res.offsite);
      await loadUsage(true);
    } catch (error) {
      toast('error', t('S3 连接失败'), (error as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function enableAttachments() {
    try {
      const response = await api.post<{ migration: { running: boolean; error: string | null } }>(
        '/api/admin/offsite/attachments/enable',
      );
      setMigrating(Boolean(response.migration?.running));
      await loadUsage(true);
      if (response.migration?.error) {
        toast('error', t('无法启用对象存储附件'), response.migration.error);
      } else if (response.migration?.running) {
        toast('success', t('开始迁移附件'), t('正在把本机附件上传到对象存储，期间附件仍可正常访问。'));
      }
    } catch (error) {
      setMigrating(false);
      toast('error', t('无法启用对象存储附件'), (error as Error).message);
    }
  }

  async function cleanupLocalCopies() {
    setCleaning(true);
    try {
      const result = await api.post<{ deleted: number; retained: number }>('/api/admin/offsite/attachments/cleanup-local');
      await loadUsage(true);
      toast(
        'success',
        t('本机副本已清理'),
        result.retained > 0
          ? t('已清理 {n} 个；{m} 个因远端校验未通过而保留。', { n: result.deleted, m: result.retained })
          : t('已清理 {n} 个本机附件副本。', { n: result.deleted }),
      );
    } catch (error) {
      toast('error', t('清理失败'), (error as Error).message);
    } finally {
      setCleaning(false);
    }
  }

  async function disableAttachments() {
    try {
      const response = await api.post<{ migration: { running: boolean; error: string | null } }>(
        '/api/admin/offsite/attachments/disable',
        { purgeRemote },
      );
      setMigrating(Boolean(response.migration?.running));
      await loadUsage(true);
      if (response.migration?.error) {
        toast('error', t('无法停用对象存储附件'), response.migration.error);
      } else if (response.migration?.running) {
        toast('success', t('开始取回附件'), t('正在从对象存储取回全部附件，完成前不会切换。'));
      }
    } catch (error) {
      setMigrating(false);
      toast('error', t('无法停用对象存储附件'), (error as Error).message);
    }
  }

  async function saveAttachmentStorage() {
    if (!attachmentConfig) return;
    setAttachmentSaving(true);
    try {
      const response = await api.put<{ attachmentStorage: AttachmentStorageConfig }>('/api/admin/attachment-storage', {
        ...attachmentConfig,
        secretAccessKey: attachmentSecret || undefined,
        cdnAuthKey: attachmentCdnKey || undefined,
      });
      setAttachmentConfig(response.attachmentStorage);
      setAttachmentSecret('');
      setAttachmentCdnKey('');
      setAttachmentEditing(false);
      await loadUsage(true);
      toast('success', t('附件存储设置已保存'));
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
    } finally {
      setAttachmentSaving(false);
    }
  }

  async function testAttachmentStorage() {
    setAttachmentTesting(true);
    try {
      await api.post('/api/admin/attachment-storage/test');
      toast('success', t('附件对象存储连接成功'));
      const response = await api.get<{ attachmentStorage: AttachmentStorageConfig }>('/api/admin/attachment-storage');
      setAttachmentConfig(response.attachmentStorage);
      await loadUsage(true);
    } catch (error) {
      toast('error', t('附件对象存储连接失败'), (error as Error).message);
    } finally {
      setAttachmentTesting(false);
    }
  }

  function applyBitifulPreset() {
    if (!attachmentConfig) return;
    setAttachmentConfig({
      ...attachmentConfig,
      endpoint: 'https://s3.bitiful.net',
      region: 'cn-east-1',
      forcePathStyle: true,
      prefix: attachmentConfig.prefix || '',
    });
  }

  if (!config || !attachmentConfig) return null;

  const visibleObjects = objects.filter((object) => {
    const query = objectQuery.trim().toLowerCase();
    if (!query) return true;
    return object.key.toLowerCase().includes(query) || object.kind.toLowerCase().includes(query);
  });

  function exportObjects() {
    const rows = [
      ['key', 'kind', 'size', 'lastModified'],
      ...visibleObjects.map((object) => [object.key, object.kind, String(object.size), object.lastModified ?? '']),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '360note-objects.csv';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const migration = usage?.migration;
  const busy = migrating || Boolean(migration?.running);
  const hasRemoteRows = (usage?.remote?.attachmentsCount ?? 0) > 0;
  const mediaConfigured = Boolean(attachmentConfig?.mediaBaseUrl.trim());
  const mediaReady = Boolean(attachmentConfig?.enabled && mediaConfigured);
  const mixed = !usage?.attachmentsEnabled && hasRemoteRows;
  const phaseLabel =
    migration?.phase === 'enabling'
      ? t('正在上传到对象存储')
      : migration?.phase === 'disabling'
        ? t('正在取回本机')
        : migration?.phase === 'purging'
          ? t('正在清理远端副本')
          : t('迁移进行中');

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <span className="settings-section-title"><Cloud size={13} style={{ display: 'inline', marginRight: 5 }} />{t('异地备份与对象存储（S3 兼容）')}</span>
        <span className="settings-section-desc">{t('实例管理员')}</span>
      </div>
      {pageError && <LoadFailure message={pageError} onRetry={() => void loadUsage(true)} />}
      <div className="banner banner-info" style={{ marginBottom: 12 }}>
        <ShieldCheck size={15} />
        <div>{t('S3 兼容存储（MinIO、R2、Backblaze、AWS S3 等）用于异地备份副本。工作区/整站备份在离开本机前已使用 360note 主密钥加密，S3 提供方无法读取。附件存储请使用下方独立设置。')}</div>
      </div>
      <div className="setting-card">
        <div className="setting-row setting-row-heading">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('启用备份副本')}</div>
            <div className="setting-row-desc">{t('每次工作区/整站备份都会复制到对象存储。建议使用私有 bucket，并给最小权限的访问密钥。')}</div>
          </div>
          <div className="setting-row-control" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBackupEditing((value) => !value)}>
              {backupEditing ? t('收起连接设置') : t('编辑连接设置')}
            </button>
            <button type="button" className={`switch ${config.enabled ? 'on' : ''}`} onClick={() => setConfig({ ...config, enabled: !config.enabled })} aria-label={t('启用备份副本')} />
          </div>
        </div>
        {backupEditing && (
          <>
        <div className="offsite-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field">
            <label>Endpoint</label>
            <input className="input mono" value={config.endpoint} onChange={(event) => setConfig({ ...config, endpoint: event.target.value })} placeholder="https://s3.example.com" />
          </div>
          <div className="field">
            <label>Region</label>
            <input className="input mono" value={config.region} onChange={(event) => setConfig({ ...config, region: event.target.value })} placeholder="auto" />
          </div>
          <div className="field">
            <label>Bucket</label>
            <input className="input mono" value={config.bucket} onChange={(event) => setConfig({ ...config, bucket: event.target.value })} placeholder="360note-backups" />
          </div>
          <div className="field">
            <label>Prefix</label>
            <input className="input mono" value={config.prefix} onChange={(event) => setConfig({ ...config, prefix: event.target.value })} placeholder="360note/" />
          </div>
          <div className="field">
            <label>Access Key ID</label>
            <input className="input mono" value={config.accessKeyId} onChange={(event) => setConfig({ ...config, accessKeyId: event.target.value })} autoComplete="off" />
          </div>
          <div className="field">
            <label>Secret Access Key</label>
            <input className="input mono" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={config.hasSecret ? t('已保存（留空保持不变）') : ''} autoComplete="new-password" />
          </div>
        </div>
        <label className="checkbox-row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={config.forcePathStyle} onChange={(event) => setConfig({ ...config, forcePathStyle: event.target.checked })} />
          <span>{t('使用 Path-style 访问（MinIO 等通常需要）')}</span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || busy}>
            {saving ? <span className="spinner" /> : <Save size={13} />} {t('保存连接设置')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={test} disabled={testing || busy || (!config.hasSecret && !secret)}>
            {testing ? <span className="spinner" /> : <PlugZap size={13} />} {t('测试连接')}
          </button>
          {config.lastTestAt && (
            <span className={`badge ${config.lastTestOk ? 'badge-green' : 'badge-red'}`}>
              {config.lastTestOk ? t('连接正常') : t('连接失败')}
            </span>
          )}
        </div>
        {config.lastError && <div className="form-error" style={{ marginTop: 10 }}>{config.lastError}</div>}
        <p className="setting-note" style={{ marginTop: 10 }}>
          {t('备份副本会复制到对象存储；工作区备份可在“对象存储文件”中校验并恢复为副本。整站备份请按运维手册恢复。')}
        </p>
          </>
        )}
      </div>

      <div className="setting-card" style={{ marginTop: 12 }}>
        <div className="setting-row setting-row-heading">
          <div className="setting-row-main">
            <div className="setting-row-title">
              <HardDrive size={13} style={{ display: 'inline', marginRight: 5 }} />
              {t('附件存储')}
            </div>
            <div className="setting-row-desc">
              {usage?.attachmentsEnabled
                ? t('新附件直接写入对象存储；附件链接保持不变。')
                : t('附件当前保存在本机；启用后会先迁移已有附件，再切换新上传。')}
            </div>
          </div>
          <div className="setting-row-control" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttachmentEditing((value) => !value)}>
              {attachmentEditing ? t('收起连接设置') : t('编辑连接设置')}
            </button>
            <span className={`badge ${usage?.attachmentsEnabled ? 'badge-green' : 'badge-gray'}`}>
              {usage?.attachmentsEnabled ? t('对象存储') : t('本机')}
            </span>
          </div>
        </div>

        {attachmentEditing && (
          <>
        <div className="banner banner-info" style={{ marginBottom: 12 }}>
          <Sparkles size={15} />
          <div>{t('推荐使用缤纷云 S4（bitiful.com）：兼容 S3，并内置 CoreIX 图片处理。被分享的图片可按现代格式输出、控制质量与宽度，并可分析场景生成标签。原附件仍使用 AES-256-GCM 加密；只有被分享的图片才会生成未加密媒体副本。')}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={applyBitifulPreset}>
            <Sparkles size={13} /> {t('使用缤纷云推荐配置')}
          </button>
          <a className="btn btn-ghost btn-sm" href="https://docs.bitiful.com/coreix/basic" target="_blank" rel="noreferrer">
            {t('查看缤纷云媒体处理文档')}
          </a>
        </div>
        <div className="offsite-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field">
            <label>Endpoint</label>
            <input className="input mono" value={attachmentConfig.endpoint} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, endpoint: event.target.value })} placeholder="https://s3.bitiful.net" />
          </div>
          <div className="field">
            <label>Region</label>
            <input className="input mono" value={attachmentConfig.region} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, region: event.target.value })} placeholder="cn-east-1" />
          </div>
          <div className="field">
            <label>Bucket</label>
            <input className="input mono" value={attachmentConfig.bucket} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, bucket: event.target.value })} placeholder="360note-attachments" />
          </div>
          <div className="field">
            <label>Prefix</label>
            <input className="input mono" value={attachmentConfig.prefix} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, prefix: event.target.value })} placeholder="360note/" />
          </div>
          <div className="field">
            <label>Access Key ID</label>
            <input className="input mono" value={attachmentConfig.accessKeyId} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, accessKeyId: event.target.value })} autoComplete="off" />
          </div>
          <div className="field">
            <label>Secret Access Key</label>
            <input className="input mono" type="password" value={attachmentSecret} onChange={(event) => setAttachmentSecret(event.target.value)} placeholder={attachmentConfig.hasSecret ? t('已保存（留空保持不变）') : ''} autoComplete="new-password" />
          </div>
        </div>
        <label className="checkbox-row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={attachmentConfig.forcePathStyle} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, forcePathStyle: event.target.checked })} />
          <span>{t('使用 Path-style 访问（缤纷云/MinIO 通常需要）')}</span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveAttachmentStorage()} disabled={attachmentSaving || busy}>
            {attachmentSaving ? <span className="spinner" /> : <Save size={13} />} {t('保存附件存储设置')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void testAttachmentStorage()} disabled={attachmentTesting || busy}>
            {attachmentTesting ? <span className="spinner" /> : <PlugZap size={13} />} {t('测试连接')}
          </button>
          {attachmentConfig.lastTestAt && (
            <span className={`badge ${attachmentConfig.lastTestOk ? 'badge-green' : 'badge-red'}`}>
              {attachmentConfig.lastTestOk ? t('连接正常') : t('连接失败')}
            </span>
          )}
        </div>
        {attachmentConfig.lastError && <div className="form-error" style={{ marginTop: 10 }}>{attachmentConfig.lastError}</div>}
        {attachmentConfig.legacy && <p className="setting-note" style={{ marginTop: 8 }}>{t('当前沿用备份对象存储的旧配置。建议保存一份独立的附件存储配置。')}</p>}

        <div className="setting-row setting-row-heading setting-row-heading-spaced">
          <div className="setting-row-main">
            <div className="setting-row-title"><Sparkles size={13} style={{ display: 'inline', marginRight: 5 }} />{t('图片加速与自动标签')}</div>
            <div className="setting-row-desc">
              {t('仅对可分享的笔记图片生效（含公开和密码保护分享）。媒体副本不包含加密，请为媒体域名配置 CDN 鉴权或私有访问；未分享的笔记图片不会上传。')}
              {!mediaReady && (
                <>
                  <br />
                  <strong style={{ color: 'var(--amber)' }}>
                    {mediaConfigured
                      ? t('媒体域名已填写，但附件对象存储尚未启用；启用后图片加速、图片标签、功能性图片识别和 HEIC/PDF/视频封面才会生效。')
                      : t('尚未配置媒体访问域名：分享图片优化、图片标签、功能性图片识别和 HEIC/PDF/视频封面不会生效；附件上传下载与本地 OCR 不受影响。')}
                  </strong>
                </>
              )}
            </div>
          </div>
          <div className="setting-row-control">
            <span className={`badge ${mediaReady ? 'badge-green' : 'badge-amber'}`}>
              {mediaReady ? t('已启用') : mediaConfigured ? t('待启用存储') : t('未配置域名')}
            </span>
          </div>
        </div>
        <div className="offsite-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field">
            <label>{t('媒体访问域名')}</label>
            <input className="input mono" value={attachmentConfig.mediaBaseUrl} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, mediaBaseUrl: event.target.value })} placeholder="https://img.example.com" />
            <span className="field-hint">{t('只填域名根地址，不要包含 Prefix；例如 https://img.example.com。不是 S3 Endpoint，也不是 <桶名>.<Endpoint> 拼接。')}</span>
          </div>
          <div className="field">
            <label>{t('CDN 鉴权 Key')}</label>
            <input className="input mono" type="password" value={attachmentCdnKey} onChange={(event) => setAttachmentCdnKey(event.target.value)} placeholder={attachmentConfig.hasCdnAuthKey ? t('已保存（留空保持不变）') : ''} autoComplete="new-password" />
            <span className="field-hint">{t('可选。填写后媒体 URL 会使用缤纷云高级鉴权签名。')}</span>
          </div>
          <div className="field">
            <label>{t('媒体前缀')}</label>
            <input className="input mono" value={attachmentConfig.mediaPrefix} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, mediaPrefix: event.target.value })} placeholder="media/" />
          </div>
          <div className="field">
            <label>{t('输出格式')}</label>
            <select className="select" value={attachmentConfig.imageFormat} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, imageFormat: event.target.value as AttachmentStorageConfig['imageFormat'] })}>
              <option value="auto">{t('自动（优先 AVIF/WebP）')}</option>
              <option value="webp">WebP</option>
              <option value="jpg">JPEG</option>
            </select>
          </div>
          <div className="field">
            <label>{t('图片质量')}</label>
            <input className="input" type="number" min={40} max={95} value={attachmentConfig.imageQuality} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, imageQuality: Number(event.target.value) })} />
            <span className="field-hint">{t('40–95；默认 82，适合网页分享。')}</span>
          </div>
          <div className="field">
            <label>{t('最大宽度')}</label>
            <input className="input" type="number" min={0} max={4096} value={attachmentConfig.imageMaxWidth} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, imageMaxWidth: Number(event.target.value) })} />
            <span className="field-hint">{t('像素；0 表示不缩放。默认 1600。')}</span>
          </div>
          <div className="field">
            <label>{t('图片标签分析')}</label>
            <select className="select" value={attachmentConfig.imageTags} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, imageTags: event.target.value as AttachmentStorageConfig['imageTags'] })}>
              <option value="off">{t('关闭')}</option>
              <option value="suggest">{t('生成标签建议')}</option>
              <option value="auto">{t('自动添加到笔记标签')}</option>
            </select>
            <span className="field-hint">{t('分析在公开分享时进行；标签来自缤纷云图片识别。')}</span>
          </div>
        </div>
        <label className="checkbox-row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={attachmentConfig.detectFunctionalImages} onChange={(event) => setAttachmentConfig({ ...attachmentConfig, detectFunctionalImages: event.target.checked })} />
          <span>
            <strong style={{ color: 'var(--text-soft)' }}>{t('识别文档、发票、截图并自动 OCR')}</strong>
            <span className="field-hint" style={{ display: 'block' }}>{t('上传图片后会在缤纷云临时分析功能性图片；识别为截图、发票或文档时自动提取文字并参与搜索。临时分析对象会立即删除。')}</span>
          </span>
        </label>

          </>
        )}

        <div className="admin-stats" style={{ marginTop: 4 }}>
          <div className="setting-card">
            <span style={{ color: 'var(--text-tertiary)' }}><HardDrive size={15} /></span>
            <div className="admin-stat-value">{formatBytes(usage?.local.bytes ?? 0)}</div>
            <div className="setting-note">{t('本机附件占用')} · {usage?.local.files ?? 0} {t('个文件')}</div>
          </div>
          <div className="setting-card">
            <span style={{ color: 'var(--text-tertiary)' }}><Cloud size={15} /></span>
            <div className="admin-stat-value">{formatBytes(usage?.remote?.attachments.bytes ?? 0)}</div>
            <div className="setting-note">{t('对象存储附件')} · {usage?.remote?.attachments.objects ?? 0} {t('个对象')}</div>
          </div>
          <div className="setting-card">
            <span style={{ color: 'var(--text-tertiary)' }}><CloudUpload size={15} /></span>
            <div className="admin-stat-value">{formatBytes(usage?.remote?.backups.bytes ?? 0)}</div>
            <div className="setting-note">{t('对象存储备份')} · {usage?.remote?.backups.objects ?? 0} {t('个对象')}</div>
          </div>
        </div>

        {usage?.remote && !usage.remote.available && (
          <div className="form-error" style={{ marginTop: 10 }}>{t('无法读取对象存储用量')}：{usage.remote.error}</div>
        )}

        {busy ? (
          <div className="setting-card" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span className="spinner" />
              <strong>{phaseLabel}</strong>
            </div>
            <div className="settings-progress" style={{ marginTop: 8 }}>
              <span style={{ width: `${migration && migration.total > 0 ? Math.min(100, Math.round((migration.processed / migration.total) * 100)) : 0}%` }} />
            </div>
            <div className="setting-note" style={{ marginTop: 6 }}>
              {migration ? `${migration.processed} / ${migration.total}` : '0 / 0'}
              {migration?.failed ? ` · ${t('失败')} ${migration.failed}` : ''}
              {migration?.message ? ` · ${migration.message}` : ''}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {usage?.attachmentsEnabled ? (
              <>
                <label className="checkbox-row" style={{ margin: 0 }}>
                  <input type="checkbox" checked={purgeRemote} onChange={(event) => setPurgeRemote(event.target.checked)} />
                  <span>{t('取回成功后清除对象存储中的附件副本')}</span>
                </label>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void disableAttachments()}>
                  <CloudDownload size={13} /> {t('停用并取回全部附件')}
                </button>
                {(usage?.local.files ?? 0) > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cleanupLocalCopies()} disabled={cleaning}>
                    {cleaning ? <span className="spinner" /> : <HardDrive size={13} />} {t('清理本机副本')}
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void enableAttachments()}
                  disabled={!usage?.configured || !attachmentConfig.hasSecret}
                >
                  <CloudUpload size={13} /> {mixed ? t('继续迁移剩余附件') : t('启用并迁移已有附件')}
                </button>
                {mixed && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void disableAttachments()}>
                    <CloudDownload size={13} /> {t('取回已上传的附件')}
                  </button>
                )}
              </>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadUsage(true)}>{t('刷新用量')}</button>
          </div>
        )}

        {migration?.error && <div className="form-error" style={{ marginTop: 10 }}>{migration.error}</div>}
        {mixed && <p className="setting-note" style={{ marginTop: 8 }}>{t('当前有部分附件在对象存储、部分在本机。可以继续迁移，或先取回已上传的附件。')}</p>}
        {!usage?.configured && <p className="setting-note" style={{ marginTop: 8 }}>{t('请先填写并保存完整的连接配置，再启用附件对象存储。')}</p>}
        <p className="setting-note" style={{ marginTop: 10 }}>
          {t('启用时会先检查对象存储中是否已有同目录、同名称、同大小的文件，已有则跳过上传；停用前会逐个取回并校验，全部成功后才切换回本机。附件链接始终是 /api/attachments/:id/content，不会因切换而失效。')}
        </p>
        <p className="setting-note">
          {t('附件通过站点域名加密代理访问，因此图片 URL 显示为 360biji.com 或 360note.com，而不是对象存储域名；实际文件保存在对象存储。')}
        </p>
      </div>

      <div className="setting-card" style={{ marginTop: 12 }}>
        <div className="setting-row setting-row-heading">
          <div className="setting-row-main">
            <div className="setting-row-title"><Cloud size={13} style={{ display: 'inline', marginRight: 5 }} />{t('对象存储文件')}</div>
            <div className="setting-row-desc">{t('浏览、校验和恢复备份对象存储中的文件。恢复工作区备份会以副本形式合并，不覆盖现有内容。')}</div>
          </div>
          <div className="setting-row-control admin-object-tools">
            <input className="input input-sm" value={objectQuery} onChange={(event) => setObjectQuery(event.target.value)} placeholder={t('筛选对象…')} style={{ width: 180 }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={exportObjects} disabled={visibleObjects.length === 0}>
              <Download size={13} /> {t('导出 CSV')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadObjects()} disabled={objectsLoading}>
              {objectsLoading ? <span className="spinner" /> : <RefreshCw size={13} />} {t('刷新文件')}
            </button>
          </div>
        </div>
        <div className="setting-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table admin-object-table">
            <thead><tr><th>{t('对象')}</th><th>{t('类型')}</th><th>{t('大小')}</th><th>{t('更新时间')}</th><th>{t('操作')}</th></tr></thead>
            <tbody>
              {objectsError ? (
                <tr><td colSpan={5}><LoadFailure message={objectsError} onRetry={() => void loadObjects()} compact /></td></tr>
              ) : visibleObjects.length === 0 ? (
                <tr><td colSpan={5}><div className="context-empty">{objectsLoading ? t('加载中…') : objectQuery ? t('没有匹配的对象') : t('没有对象或尚未配置连接')}</div></td></tr>
              ) : visibleObjects.map((object) => (
                <tr key={object.key}>
                  <td><div className="admin-object-key" title={object.key}>{object.key}</div></td>
                  <td>{object.kind === 'attachment' ? t('附件') : object.kind === 'workspace-backup' ? t('工作区备份') : object.kind === 'instance-backup' ? t('整站备份') : t('其他')}</td>
                  <td>{formatBytes(object.size)}</td>
                  <td className="setting-note">{object.lastModified ? formatRelativeShort(object.lastModified) : '—'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void verifyObject(object.key)}>{t('校验')}</button>
                      <a className="icon-btn icon-btn-sm" href={`/api/admin/offsite/objects/download?key=${encodeURIComponent(object.key)}`} title={t('下载')} aria-label={t('下载')}><Download size={13} /></a>
                      {object.kind === 'workspace-backup' && (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRestoreKey(object.key)} disabled={restoring === object.key}>
                          {restoring === object.key ? <span className="spinner" /> : null} {t('恢复为副本')}
                        </button>
                      )}
                    </div>
                    {verifyState[object.key] && <div className={`setting-note ${verifyState[object.key].ok ? 'text-green' : 'text-red'}`} style={{ marginTop: 3 }}>{verifyState[object.key].text}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="setting-note" style={{ marginTop: 8 }}>{t('整站备份只支持校验和下载，数据库级恢复请按运维手册执行。')}</p>
      </div>
      <ConfirmDialog
        open={Boolean(restoreKey)}
        onClose={() => setRestoreKey(null)}
        onConfirm={() => {
          const key = restoreKey;
          setRestoreKey(null);
          if (key) void restoreObject(key);
        }}
        title={t('从对象存储恢复')}
        description={t('把这份工作区备份恢复为副本？不会覆盖当前内容。')}
        confirmLabel={t('恢复为副本')}
      />
    </section>
  );
}
