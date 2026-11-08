import { useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { useT } from '../../lib/i18n';
import { applyTheme, storeTheme, type ThemePreference } from '../../lib/theme';
import { api } from '../../lib/api';
import { toast } from '../../stores/toast';
import { cn } from '../../lib/utils';
import type { User } from '@360note/shared';

export default function AppearanceSettings() {
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [theme, setTheme] = useState<ThemePreference>((user?.prefs?.theme as ThemePreference) ?? 'system');
  const [width, setWidth] = useState<'narrow' | 'wide'>((user?.prefs?.editorWidth as 'narrow' | 'wide') ?? 'wide');
  const [reduceMotion, setReduceMotion] = useState(Boolean(user?.prefs?.reduceMotion));

  async function persist(patch: Record<string, unknown>) {
    try {
      const response = await api.patch<{ user: User }>('/api/me/prefs', patch);
      setUser(response.user);
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
    }
  }

  function changeTheme(next: ThemePreference) {
    setTheme(next);
    storeTheme(next, reduceMotion);
    void persist({ theme: next });
  }

  return (
    <>
      <h1 className="settings-title">{t('外观')}</h1>
      <p className="settings-subtitle">{t('主题与阅读宽度会同步到你的账户，在其他设备上也会生效。界面语言由访问域名决定。')}</p>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('主题')}</span>
          <span className="settings-section-desc">{t('跟随系统会在日落时自动切换')}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 9 }} className="theme-grid">
          {(
            [
              { id: 'system', label: t('跟随系统'), icon: Monitor },
              { id: 'light', label: t('浅色'), icon: Sun },
              { id: 'dark', label: t('深色'), icon: Moon },
            ] as const
          ).map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => changeTheme(option.id)}
                style={{
                  textAlign: 'left',
                  padding: 10,
                  borderRadius: 9,
                  border: `1px solid ${theme === option.id ? 'var(--blue)' : 'var(--line)'}`,
                  background: 'var(--surface)',
                }}
              >
                <div
                  style={{
                    height: 64,
                    borderRadius: 6,
                    marginBottom: 8,
                    overflow: 'hidden',
                    border: '1px solid var(--line)',
                    display: 'flex',
                    background: option.id === 'dark' ? '#0d111e' : option.id === 'light' ? '#f8f6f1' : 'linear-gradient(90deg,#0d111e 50%,#f8f6f1 50%)',
                  }}
                >
                  <div
                    style={{
                      width: 22,
                      background:
                        option.id === 'light'
                          ? '#f1eee7'
                          : option.id === 'dark'
                            ? '#070c1c'
                            : 'linear-gradient(90deg,#070c1c 50%,#f1eee7 50%)',
                    }}
                  />
                  <div style={{ flex: 1, padding: 7 }}>
                    <div style={{ height: 5, width: '55%', borderRadius: 2, background: option.id === 'dark' ? '#e6e3dc' : '#23252a', opacity: 0.8 }} />
                    <div style={{ height: 3, width: '80%', borderRadius: 2, background: option.id === 'dark' ? '#3a4157' : '#ddd8ce', marginTop: 5 }} />
                    <div style={{ height: 3, width: '66%', borderRadius: 2, background: option.id === 'dark' ? '#3a4157' : '#ddd8ce', marginTop: 3 }} />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text)' }}>
                  <Icon size={13} /> {option.label}
                  {theme === option.id && <Check size={12} style={{ marginLeft: 'auto', color: 'var(--blue)' }} />}
                </div>
              </button>
            );
          })}
        </div>
        <label className="checkbox-row" style={{ marginTop: 16 }}>
          <input
            type="checkbox"
            checked={reduceMotion}
            onChange={(event) => {
              setReduceMotion(event.target.checked);
              storeTheme(theme, event.target.checked);
              void persist({ reduceMotion: event.target.checked });
            }}
          />
          <span>
            <strong style={{ color: 'var(--text-soft)' }}>{t('减少动效')}</strong>
            <span className="field-hint" style={{ display: 'block' }}>{t('关闭过渡与浮动动画，适合对动效敏感的用户。')}</span>
          </span>
        </label>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('编辑器外观')}</span>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('编辑宽度')}</div>
            <div className="setting-row-desc">{t('窄栏约 700px，宽栏约 980px。')}</div>
          </div>
          <div className="setting-row-control">
            <div className="segmented">
              <button type="button" className={width === 'narrow' ? 'active' : ''} onClick={() => { setWidth('narrow'); void persist({ editorWidth: 'narrow' }); }}>{t('窄')}</button>
              <button type="button" className={width === 'wide' ? 'active' : ''} onClick={() => { setWidth('wide'); void persist({ editorWidth: 'wide' }); }}>{t('宽')}</button>
            </div>
          </div>
        </div>
        <div className="setting-note" style={{ marginTop: 8 }}>
          {t('预览：正文将以当前字体和宽度显示。')}
          <div
            className="prose"
            style={{
              marginTop: 10,
              padding: '14px 16px',
              border: '1px solid var(--line)',
              borderRadius: 8,
              background: 'var(--surface)',
              fontSize: 14,
              maxWidth: width === 'narrow' ? 430 : 560,
            }}
          >
            <p style={{ margin: 0 }}>{t('好的编辑体验不打扰思路。文字应该像落在纸上，而不是落在一个表单里。')}</p>
          </div>
        </div>
      </section>
    </>
  );
}
