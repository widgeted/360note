import { useEffect, useRef, useState } from 'react';
import { LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CustomTemplate } from '../../lib/templates';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { toast } from '../../stores/toast';
import { Modal } from '../Modal';
import { formatRelativeShort } from '../../lib/utils';

const VARIABLES = ['{{date}}', '{{time}}', '{{datetime}}', '{{title}}', '{{user}}', '{{workspace}}', '{{folder}}'];

interface Draft {
  id?: string;
  name: string;
  description: string;
  titleTemplate: string;
  contentTemplate: string;
}

const EMPTY: Draft = { name: '', description: '', titleTemplate: '', contentTemplate: '' };

export default function TemplateSettings() {
  const t = useT();
  const [templates, setTemplates] = useState<CustomTemplate[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  async function load() {
    try {
      const response = await api.get<{ templates: CustomTemplate[] }>('/api/templates');
      setTemplates(response.templates);
    } catch (error) {
      toast('error', t('加载失败'), (error as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function insertVariable(variable: string) {
    if (!draft) return;
    const target = contentRef.current;
    if (!target) {
      setDraft({ ...draft, contentTemplate: `${draft.contentTemplate}${variable}` });
      return;
    }
    const start = target.selectionStart ?? draft.contentTemplate.length;
    const end = target.selectionEnd ?? start;
    const next = `${draft.contentTemplate.slice(0, start)}${variable}${draft.contentTemplate.slice(end)}`;
    setDraft({ ...draft, contentTemplate: next });
    requestAnimationFrame(() => {
      target.focus();
      target.setSelectionRange(start + variable.length, start + variable.length);
    });
  }

  async function save() {
    if (!draft?.name.trim()) return;
    setSaving(true);
    try {
      if (draft.id) {
        await api.patch(`/api/templates/${draft.id}`, {
          name: draft.name.trim(),
          description: draft.description,
          titleTemplate: draft.titleTemplate,
          contentTemplate: draft.contentTemplate,
        });
      } else {
        await api.post('/api/templates', {
          name: draft.name.trim(),
          description: draft.description,
          titleTemplate: draft.titleTemplate,
          contentTemplate: draft.contentTemplate,
        });
      }
      setDraft(null);
      await load();
      toast('success', t('模板已保存'));
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(template: CustomTemplate) {
    if (!window.confirm(t('删除模板“{name}”？', { name: template.name }))) return;
    try {
      await api.delete(`/api/templates/${template.id}`);
      await load();
      toast('success', t('模板已删除'));
    } catch (error) {
      toast('error', t('删除失败'), (error as Error).message);
    }
  }

  return (
    <>
      <h1 className="settings-title">{t('模板')}</h1>
      <p className="settings-subtitle">{t('把常用的笔记结构保存为模板，新建时一键展开。变量会在创建时替换。')}</p>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">{t('自定义模板')}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setDraft({ ...EMPTY })}>
            <Plus size={13} /> {t('新建模板')}
          </button>
        </div>
        {templates.length === 0 ? (
          <div className="context-empty">{t('还没有自定义模板。')}</div>
        ) : (
          <div className="settings-section" style={{ marginTop: 10, padding: 0 }}>
            {templates.map((template) => (
              <div className="setting-row" key={template.id}>
                <div className="setting-row-main">
                  <div className="setting-row-title"><LayoutTemplate size={13} style={{ display: 'inline', marginRight: 5 }} />{template.name}</div>
                  <div className="setting-row-desc">{template.description || t('无描述')} · {formatRelativeShort(template.updatedAt)}</div>
                </div>
                <div className="setting-row-control" style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    title={t('编辑')}
                    aria-label={t('编辑')}
                    onClick={() => setDraft({
                      id: template.id,
                      name: template.name,
                      description: template.description,
                      titleTemplate: template.titleTemplate,
                      contentTemplate: template.contentTemplate,
                    })}
                  >
                    <Pencil size={13} />
                  </button>
                  <button type="button" className="icon-btn icon-btn-sm" title={t('删除')} aria-label={t('删除')} onClick={() => void remove(template)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="setting-note" style={{ marginTop: 8 }}>{t('模板只属于你自己，可以随时修改或删除。')}</p>
      </section>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? t('编辑模板') : t('新建模板')}
        description={t('使用变量让模板在每次创建时自动填充。')}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft(null)}>{t('取消')}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving || !draft?.name.trim()}>
              {saving ? <span className="spinner" /> : null} {t('保存模板')}
            </button>
          </>
        }
      >
        {draft && (
          <>
            <div className="field">
              <label>{t('模板名称')}</label>
              <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={120} placeholder={t('例：周会记录')} />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>{t('描述（可选）')}</label>
              <input className="input" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} maxLength={300} />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>{t('标题模板')}</label>
              <input className="input" value={draft.titleTemplate} onChange={(event) => setDraft({ ...draft, titleTemplate: event.target.value })} maxLength={500} placeholder="{{date}} 周会记录" />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>{t('正文模板')}</label>
              <textarea
                ref={contentRef}
                className="input"
                rows={9}
                value={draft.contentTemplate}
                onChange={(event) => setDraft({ ...draft, contentTemplate: event.target.value })}
                maxLength={50_000}
                style={{ height: 'auto', paddingTop: 8, paddingBottom: 8, fontFamily: 'var(--font-mono)', fontSize: 13 }}
                placeholder={'# {{title}}\n\n## 参与人\n\n## 议题'}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
              {VARIABLES.map((variable) => (
                <button key={variable} type="button" className="tag-token" onClick={() => insertVariable(variable)}>
                  {variable}
                </button>
              ))}
            </div>
            <p className="setting-note" style={{ marginTop: 8 }}>{t('可用变量：日期、时间、标题、用户名、空间名和文件夹名。未知变量会原样保留。')}</p>
          </>
        )}
      </Modal>
    </>
  );
}
