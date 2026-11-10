import { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, CloudDownload, CloudUpload, HardDrive, PlugZap, Save, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useT } from '../../lib/i18n';
import { toast } from '../../stores/toast';
import { formatBytes } from '../../lib/utils';

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
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [secret, setSecret] = useState('');
  const [purgeRemote, setPurgeRemote] = useState(false);
  const pollRef = useRef<number | null>(null);

  const loadUsage = useCallback(async (force = false) => {
    try {
      const response = await api.get<StorageUsage>(`/api/admin/offsite/usage${force ? '?force=1' : ''}`);
      setUsage(response);
      return response;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    api.get<{ offsite: OffsiteConfig }>('/api/admin/offsite').then((res) => setConfig(res.offsite)).catch(() => {});
    void loadUsage(true);
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

  if (!config) return null;

  const migration = usage?.migration;
  const busy = migrating || Boolean(migration?.running);
  const hasRemoteRows = (usage?.remote?.attachmentsCount ?? 0) > 0;
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
      <div className="banner banner-info" style={{ marginBottom: 12 }}>
        <ShieldCheck size={15} />
        <div>{t('S3 兼容存储（MinIO、R2、Backblaze、AWS S3 等）可同时用于备份副本和笔记附件。所有内容在离开本机前都已使用 360note 主密钥加密，S3 提供方无法读取。')}</div>
      </div>
      <div className="setting-card">
        <div className="setting-row" style={{ paddingTop: 0 }}>
          <div className="setting-row-main">
            <div className="setting-row-title">{t('启用备份副本')}</div>
            <div className="setting-row-desc">{t('每次工作区/整站备份都会复制到对象存储。建议使用私有 bucket，并给最小权限的访问密钥。')}</div>
          </div>
          <div className="setting-row-control">
            <button type="button" className={`switch ${config.enabled ? 'on' : ''}`} onClick={() => setConfig({ ...config, enabled: !config.enabled })} aria-label={t('启用备份副本')} />
          </div>
        </div>
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
          {t('备份副本只负责复制，不在应用内从远端恢复。需要恢复时，从 S3 下载 .3nb，再使用“上传备份文件”。')}
        </p>
      </div>

      <div className="setting-card" style={{ marginTop: 12 }}>
        <div className="setting-row" style={{ paddingTop: 0 }}>
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
          <div className="setting-row-control">
            <span className={`badge ${usage?.attachmentsEnabled ? 'badge-green' : 'badge-gray'}`}>
              {usage?.attachmentsEnabled ? t('对象存储') : t('本机')}
            </span>
          </div>
        </div>

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
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void enableAttachments()}
                  disabled={!usage?.configured || !config.hasSecret}
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
    </section>
  );
}
