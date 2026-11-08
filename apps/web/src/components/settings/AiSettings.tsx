import { useEffect, useState } from 'react';
import { Bot, Check, Eye, EyeOff, LockKeyhole, Save, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useT } from '../../lib/i18n';
import { toast } from '../../stores/toast';

interface AdminSettings {
  ai: { enabled: boolean; baseUrl: string; model: string; providerLabel: string; hasApiKey: boolean };
  environment: { version: string; publicOrigin: string };
}

export default function AiSettings() {
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const instance = useAuthStore((state) => state.instance);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get<AdminSettings>('/api/admin/settings')
      .then((response) => {
        setSettings(response);
        setEnabled(response.ai.enabled);
        setBaseUrl(response.ai.baseUrl);
        setModel(response.ai.model);
      })
      .catch(() => {});
  }, [isAdmin]);

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
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1 className="settings-title">{t('AI 与隐私')}</h1>
      <p className="settings-subtitle">{t('AI 是可选的高级能力，默认关闭，不会自动弹窗，也不会在你不知情时读取笔记。')}</p>

      <div className="banner banner-info" style={{ marginBottom: 26 }}>
        <ShieldCheck size={15} />
        <div>
          <strong>{t('你的笔记不会被用于训练模型。')}</strong> {t('只有当你在单篇笔记中主动点击“AI 摘要”时，该篇内容才会发送给实例管理员配置的兼容服务。')}
        </div>
      </div>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('数据如何使用')}</span>
          <span className="settings-section-desc">{t('按需、最小范围')}</span>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('AI 数据政策')}</div>
            <div className="setting-row-desc">{t('不用于训练；不自动发送；不包含其他笔记；不包含账户密码或恢复密钥。加密笔记永远不会发送。')}</div>
          </div>
          <div className="setting-row-control"><span className="badge badge-green">{t('不训练')}</span></div>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('可随时关闭')}</div>
            <div className="setting-row-desc">{t('关闭后，AI 摘要入口会隐藏；360note 不会生成或保存摘要。')}</div>
          </div>
          <div className="setting-row-control">
            <span className={`badge ${instance?.aiEnabled ? 'badge-green' : ''}`}>{instance?.aiEnabled ? t('实例已启用') : t('实例未启用')}</span>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('影响范围')}</div>
            <div className="setting-row-desc">{t('AI 不参与同步、搜索索引、备份或分享。公开分享页面不会调用 AI。')}</div>
          </div>
        </div>
      </section>

      {isAdmin ? (
        <section className="settings-section">
          <div className="settings-section-head">
            <span className="settings-section-title"><Bot size={13} style={{ display: 'inline', marginRight: 5 }} />{t('实例 AI 设置')}</span>
            <span className="settings-section-desc">{t('仅实例管理员可见')}</span>
          </div>
          <div className="setting-card">
            <div className="setting-row" style={{ paddingTop: 0 }}>
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
        </section>
      ) : (
        <section className="settings-section">
          <div className="settings-section-head"><span className="settings-section-title">{t('实例 AI 设置')}</span></div>
          <div className="banner">
            <LockKeyhole size={15} />
            <div>{t('仅实例管理员可以配置 AI 服务。摘要必须由你主动触发，且只在启用后出现。')}</div>
          </div>
        </section>
      )}

      <section className="settings-section">
        <div className="settings-section-head"><span className="settings-section-title">{t('摘要入口在哪里？')}</span></div>
        <div className="principles-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8, border: 0, background: 'transparent' }}>
          <div className="setting-card">
            <Sparkles size={15} style={{ color: 'var(--blue)', marginBottom: 8 }} />
            <div className="setting-row-title">{t('单篇笔记的“…”菜单')}</div>
            <p className="setting-note" style={{ marginTop: 4 }}>{t('不占用主界面，不自动弹出。需要时从单篇笔记的更多菜单中打开 AI 摘要。')}</p>
          </div>
          <div className="setting-card">
            <Check size={15} style={{ color: 'var(--green)', marginBottom: 8 }} />
            <div className="setting-row-title">{t('命令面板可搜索')}</div>
            <p className="setting-note" style={{ marginTop: 4 }}>{t('按 ⌘K 输入“摘要”即可定位，即使不记得它在哪个菜单。')}</p>
          </div>
        </div>
      </section>
    </>
  );
}
