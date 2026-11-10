import { useEffect, useState } from 'react';
import { Cloud, PlugZap, Save, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useT } from '../../lib/i18n';
import { toast } from '../../stores/toast';

interface OffsiteConfig {
  enabled: boolean;
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

export function OffsiteSettings() {
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const [config, setConfig] = useState<OffsiteConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [secret, setSecret] = useState('');

  useEffect(() => {
    if (user?.role !== 'admin') return;
    api.get<{ offsite: OffsiteConfig }>('/api/admin/offsite').then((res) => setConfig(res.offsite)).catch(() => {});
  }, [user?.role]);

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
    } catch (error) {
      toast('error', t('S3 连接失败'), (error as Error).message);
    } finally {
      setTesting(false);
    }
  }

  if (!config) return null;

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <span className="settings-section-title"><Cloud size={13} style={{ display: 'inline', marginRight: 5 }} />{t('异地备份（S3 兼容）')}</span>
        <span className="settings-section-desc">{t('实例管理员')}</span>
      </div>
      <div className="banner banner-info" style={{ marginBottom: 12 }}>
        <ShieldCheck size={15} />
        <div>{t('开启后，每次备份都会把已加密的 .3nb 复制到你的 S3 兼容存储（MinIO、R2、Backblaze、AWS S3 等）。备份使用 360note 主密钥加密，S3 提供方无法读取内容。')}</div>
      </div>
      <div className="setting-card">
        <div className="setting-row" style={{ paddingTop: 0 }}>
          <div className="setting-row-main">
            <div className="setting-row-title">{t('启用异地备份')}</div>
            <div className="setting-row-desc">{t('建议使用私有 bucket，并给最小权限的访问密钥。')}</div>
          </div>
          <div className="setting-row-control">
            <button type="button" className={`switch ${config.enabled ? 'on' : ''}`} onClick={() => setConfig({ ...config, enabled: !config.enabled })} aria-label={t('启用异地备份')} />
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
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : <Save size={13} />} {t('保存异地备份设置')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={test} disabled={testing || !config.hasSecret && !secret}>
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
          {t('异地备份只负责复制，不在应用内从远端恢复。需要恢复时，从 S3 下载 .3nb，再使用上方的“上传备份文件”。')}
        </p>
      </div>
    </section>
  );
}
