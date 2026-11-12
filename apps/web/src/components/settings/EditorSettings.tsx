import { useState } from 'react';
import { Check, FileText, Keyboard, Sparkles } from 'lucide-react';
import type { User } from '@360note/shared';
import { useAuthStore } from '../../stores/auth';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';
import { toast } from '../../stores/toast';
import { shortcutLabel } from '../../lib/utils';

const SHORTCUTS = [
  { keys: 'Mod+K', label: '命令面板与搜索' },
  { keys: 'Mod+N', label: '新建笔记' },
  { keys: 'Mod+S', label: '立即保存' },
  { keys: 'Mod+\\', label: '收起或展开侧栏' },
  { keys: 'Mod+J', label: '显示或隐藏信息面板' },
  { keys: '/', label: '在正文中插入内容块' },
  { keys: 'Mod+B / Mod+I / Mod+U', label: '加粗 / 斜体 / 下划线' },
  { keys: 'Mod+Z / Mod+Shift+Z', label: '撤销 / 重做' },
];

export default function EditorSettings() {
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [spellcheck, setSpellcheck] = useState(user?.prefs?.spellcheck !== false);
  const [format, setFormat] = useState<'rich' | 'markdown'>((user?.prefs?.defaultNoteFormat as 'rich' | 'markdown') ?? 'rich');

  async function persist(patch: Record<string, unknown>) {
    try {
      const response = await api.patch<{ user: User }>('/api/me/prefs', patch);
      setUser(response.user);
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
    }
  }

  return (
    <>
      <h1 className="settings-title">{t('编辑器')}</h1>
      <p className="settings-subtitle">{t('360笔记以 Markdown 为底层格式，同时提供所见即所得编辑。所有设置只影响界面，不影响内容。')}</p>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('写作默认值')}</span>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('默认笔记格式')}</div>
            <div className="setting-row-desc">{t('对之后新建的笔记生效。已有笔记会记住各自上次使用的模式，你也可以在编辑器底部随时切换。')}</div>
          </div>
          <div className="setting-row-control">
            <div className="segmented">
              <button type="button" className={format === 'rich' ? 'active' : ''} onClick={() => { setFormat('rich'); void persist({ defaultNoteFormat: 'rich' }); }}>{t('富文本')}</button>
              <button type="button" className={format === 'markdown' ? 'active' : ''} onClick={() => { setFormat('markdown'); void persist({ defaultNoteFormat: 'markdown' }); }}>Markdown</button>
            </div>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('拼写检查')}</div>
            <div className="setting-row-desc">{t('使用浏览器的拼写检查。关闭后界面更安静，适合中英混排。')}</div>
          </div>
          <div className="setting-row-control">
            <button
              type="button"
              className={`switch ${spellcheck ? 'on' : ''}`}
              onClick={() => {
                const next = !spellcheck;
                setSpellcheck(next);
                void persist({ spellcheck: next });
              }}
              aria-label={t('拼写检查')}
            />
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('Markdown 源码模式')}</div>
            <div className="setting-row-desc">{t('在编辑器底部点击 M↓ 即可切换。内容始终以 Markdown 保存，切换不会改变格式。')}</div>
          </div>
          <div className="setting-row-control">
            <span className="badge"><FileText size={10} /> Markdown</span>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('模板')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.dispatchEvent(new Event('nh:open-templates'))}>
            <Sparkles size={13} /> {t('从模板创建')}
          </button>
        </div>
        <p className="setting-note">{t('默认模板会出现在模板列表中，可以修改或删除；也可以新建自己的模板。')}</p>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title"><Keyboard size={13} style={{ display: 'inline', marginRight: 5 }} />{t('快捷键')}</span>
        </div>
        <div className="setting-card" style={{ padding: '4px 14px' }}>
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="setting-row" style={{ padding: '10px 0' }}>
              <div className="setting-row-main">
                <div className="setting-row-title" style={{ fontWeight: 450 }}>{t(shortcut.label)}</div>
              </div>
              <div className="setting-row-control">
                <kbd>{shortcutLabel(shortcut.keys)}</kbd>
              </div>
            </div>
          ))}
        </div>
        <p className="setting-note" style={{ marginTop: 10 }}>{t('命令面板会列出所有低频功能，即使不记得快捷键也能找到。')}</p>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('写作体验')}</span>
        </div>
        <div className="principles-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8, border: 0, background: 'transparent' }}>
          <div className="setting-card">
            <Check size={15} style={{ color: 'var(--green)', marginBottom: 8 }} />
            <div className="setting-row-title">{t('自动保存与草稿')}</div>
            <p className="setting-note" style={{ marginTop: 4 }}>{t('停止输入约 0.8 秒后自动保存；浏览器崩溃或离线时会保留草稿，下次打开可恢复。')}</p>
          </div>
          <div className="setting-card">
            <Check size={15} style={{ color: 'var(--blue)', marginBottom: 8 }} />
            <div className="setting-row-title">{t('冲突保留副本')}</div>
            <p className="setting-note" style={{ marginTop: 4 }}>{t('多设备同时编辑时，先尝试三向合并；无法合并的内容会保留为冲突副本，而不是静默覆盖。')}</p>
          </div>
        </div>
      </section>
    </>
  );
}
