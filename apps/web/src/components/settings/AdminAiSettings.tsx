import { useEffect, useState } from 'react';
import { Bot, Eye, EyeOff, Save } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useT } from '../../lib/i18n';
import { toast } from '../../stores/toast';

interface AdminSettings {
  ai: { enabled: boolean; baseUrl: string; model: string; providerLabel: string; hasApiKey: boolean };
  environment: { version: string; publicOrigin: string };
}

export function AdminAiSettings() {
  const t = useT();
  const setUser = useAuthStore((state) => state.setUser);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<AdminSettings>('/api/admin/settings')
      .then((response) => {
        setSettings(response);
        setEnabled(response.ai.enabled);
        setBaseUrl(response.ai.baseUrl);
        setModel(response.ai.model);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.put('/api/admin/settings', {
        ai: {
          enabled,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          apiKey: apiKey.trim() || undefined,
        },
      });
      toast('success', t('设置已保存'));
      setApiKey('');
      const response = await api.get<AdminSettings>('/api/admin/settings');
      setSettings(response);
      await useAuthStore.getState().refresh();
      const user = useAuthStore.getState().user;
      if (user) setUser(user);
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <span className="settings-section-title"><Bot size={13} style={{ display: 'inline', marginRight: 5 }} />{t('AI 服务')}</span>
        <span className="settings-section-desc">{t('仅实例管理员可见')}</span>
      </div>
      <div className="setting-card">
        <div className="setting-row setting-row-heading">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('启用 AI 摘要')}</div>
            <div className="setting-row-desc">{t('开启后，用户仍然需要在单篇笔记中主动点击。')}</div>
          </div>
          <div className="setting-row-control">
            <button type="button" className={`switch ${enabled ? 'on' : ''}`} onClick={() => setEnabled((value) => !value)} aria-label={t('启用 AI 摘要')} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="field">
            <label>{t('服务地址')}</label>
            <input className="input mono" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" />
            <span className="field-hint">{t('OpenAI 兼容的 /chat/completions 接口地址。')}</span>
          </div>
          <div className="field">
            <label>{t('模型')}</label>
            <input className="input mono" value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-4.1-mini" />
          </div>
          <div className="field">
            <label>{t('API Key')}</label>
            <div style={{ position: 'relative' }}>
              <input className="input mono" type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.ai.hasApiKey ? t('已保存 Key（留空保持不变）') : 'sk-…'} autoComplete="off" style={{ paddingRight: 38 }} />
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => setShowKey((value) => !value)} style={{ position: 'absolute', right: 6, top: 7 }} aria-label={showKey ? t('隐藏') : t('显示')}>
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <span className="field-hint">{t('Key 在服务器上加密保存，界面不会回显。')}</span>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || (enabled && (!baseUrl.trim() || !model.trim()))} style={{ alignSelf: 'flex-start' }}>
            {saving ? <span className="spinner" /> : <Save size={13} />} {t('保存并应用')}
          </button>
        </div>
      </div>
      <p className="setting-note" style={{ marginTop: 8 }}>{t('AI 摘要必须由用户主动触发；实例管理员不能读取用户笔记正文。')}</p>
    </section>
  );
}
