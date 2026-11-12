import { useState } from 'react';
import { Check, ExternalLink, Languages, Monitor, Moon, Sun } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { getLocale, setLocale, useT } from '../../lib/i18n';
import { applyTheme, storeTheme, type ThemePreference } from '../../lib/theme';
import { api } from '../../lib/api';
import { toast } from '../../stores/toast';
import { cn } from '../../lib/utils';
import type { User } from '@360note/shared';

export default function AppearanceSettings() {
  const t = useT();
  const locale = getLocale();
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

  function switchLanguage() {
    const host = window.location.hostname.toLowerCase();
    const target =
      host === '360note.com' || host === 'www.360note.com'
        ? 'https://360biji.com'
        : host === '360biji.com' || host === 'www.360biji.com'
          ? 'https://360note.com'
          : null;
    if (target) {
      window.location.assign(`${target}${window.location.pathname}${window.location.search}${window.location.hash}`);
      return;
    }
    // Localhost/preview has no counterpart domain; toggle in place for testing.
    const next = locale === 'en' ? 'zh-CN' : 'en';
    setLocale(next);
    toast('success', next === 'zh-CN' ? t('已切换到中文') : t('已切换到英文'));
  }

  return (
    <>
      <h1 className="settings-title">{t('外观')}</h1>
      <p className="settings-subtitle">{t('主题与阅读宽度会同步到你的账户；界面语言由访问的站点版本决定。')}</p>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('主题')}</span>
          <span className="settings-section-desc">{t('跟随系统会在日落时自动切换')}</span>
        </div>
        <div className="theme-grid">
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
                className={`theme-option ${theme === option.id ? 'selected' : ''}`}
              >
                <div className="theme-preview" data-preview={option.id}>
                  <div className="theme-preview-sidebar">
                    <span className="theme-preview-brand" />
                    <span className="theme-preview-nav active" />
                    <span className="theme-preview-nav" />
                    <span className="theme-preview-nav short" />
                  </div>
                  <div className="theme-preview-list">
                    <span className="theme-preview-search" />
                    <span className="theme-preview-card active"><i /><i /></span>
                    <span className="theme-preview-card"><i /><i /></span>
                    <span className="theme-preview-card"><i /><i /></span>
                  </div>
                  <div className="theme-preview-editor">
                    <span className="theme-preview-line theme-preview-line-strong" />
                    <span className="theme-preview-line theme-preview-line-soft" />
                    <span className="theme-preview-line theme-preview-line-short" />
                    <span className="theme-preview-line theme-preview-line-soft" />
                  </div>
                </div>
                <div className="theme-option-label">
                  <Icon size={13} /> {option.label}
                  {theme === option.id && <Check size={12} className="theme-option-check" />}
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
          <span className="settings-section-title">{t('语言')}</span>
          <span className="settings-section-desc">{locale === 'en' ? 'English' : '中文'}</span>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('界面语言')}</div>
            <div className="setting-row-desc">{t('切换到另一个站点版本；账户、笔记、附件与空间共享，登录状态按域名独立。')}</div>
          </div>
          <div className="setting-row-control">
            <button type="button" className="btn btn-secondary btn-sm" onClick={switchLanguage}>
              <Languages size={13} /> {locale === 'en' ? t('前往中文版') : 'Turn to English version'} <ExternalLink size={11} />
            </button>
          </div>
        </div>
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
          <div className={`width-preview ${width}`}>
            <p>{t('好的编辑体验不打扰思路。文字应该像落在纸上，而不是落在一个表单里。')}</p>
          </div>
        </div>
      </section>
    </>
  );
}
