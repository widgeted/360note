import { useEffect, useState } from 'react';
import { Code2, RotateCcw, Save } from 'lucide-react';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { toast } from '../../stores/toast';

interface SiteCodeSettings {
  code: string;
  defaultCode: string;
  maxLength: number;
}

export function AdminSiteSettings() {
  const t = useT();
  const [settings, setSettings] = useState<SiteCodeSettings | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SiteCodeSettings>('/api/admin/site-code')
      .then((response) => {
        setSettings(response);
        setCode(response.code);
        setError(null);
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const response = await api.put<SiteCodeSettings>('/api/admin/site-code', { code });
      setSettings(response);
      setCode(response.code);
      toast('success', t('站点代码已保存'));
    } catch (cause) {
      toast('error', t('保存失败'), (cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const changed = settings ? code !== settings.code : false;
  const overLimit = Boolean(settings && code.length > settings.maxLength);

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <span className="settings-section-title">
          <Code2 size={13} style={{ display: 'inline', marginRight: 5 }} />
          {t('站点代码')}
        </span>
        <span className="settings-section-desc">{t('统计与所有权验证')}</span>
      </div>

      <div className="setting-card">
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('注入到公开页面 <head> 的代码')}</div>
            <div className="setting-row-desc">
              {t('支持搜索引擎验证 meta 和公开页统计脚本。代码只插入首页、介绍、隐私和条款页的 <head>；登录、注册、/app 笔记页和分享链接都不加载，避免在密码页执行第三方脚本或泄露私有路径。')}
            </div>
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}
        {loading ? (
          <div className="loading-row"><span className="spinner" /> {t('正在加载站点代码…')}</div>
        ) : (
          <>
            <textarea
              className="input mono"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              spellCheck={false}
              rows={12}
              style={{ minHeight: 200, lineHeight: 1.65, resize: 'vertical' }}
              placeholder={'<meta name="baidu-site-verification" content="..." />'}
              aria-label={t('站点代码')}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void save()}
                disabled={saving || !changed || overLimit}
              >
                {saving ? <span className="spinner" /> : <Save size={13} />} {t('保存代码')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => settings && setCode(settings.defaultCode)}
                disabled={!settings || code === settings.defaultCode}
              >
                <RotateCcw size={13} /> {t('恢复内置验证代码')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setCode('')}
                disabled={!code}
              >
                {t('清空')}
              </button>
              <span className="setting-note" style={{ marginLeft: 'auto' }}>
                {code.length} / {settings?.maxLength ?? 20000}
              </span>
            </div>
            {overLimit && <div className="form-error" style={{ marginTop: 8 }}>{t('代码超出长度上限')}</div>}
            {changed && !overLimit && <p className="setting-note" style={{ marginTop: 8 }}>{t('有未保存的修改。保存后刷新首页查看源代码确认。')}</p>}
          </>
        )}
      </div>

      <p className="setting-note" style={{ marginTop: 8 }}>
        {t('这段代码由实例管理员维护，普通用户不可见。请只粘贴自己信任的统计或验证代码；脚本会以站点身份在公开页面运行。')}
      </p>
    </section>
  );
}
