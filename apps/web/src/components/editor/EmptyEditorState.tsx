import { useNavigate } from 'react-router-dom';
import { Check, Clock3, FileText, LayoutTemplate, PenLine, UploadCloud } from 'lucide-react';
import { useAppStore } from '../../stores/app';
import { useT } from '../../lib/i18n';
import { shortcutLabel } from '../../lib/utils';

/**
 * Lightweight empty state shared by the editor route. Kept separate from the
 * heavy editor module so the shell never downloads TipTap before a note opens.
 */
export function EmptyEditorState() {
  const t = useT();
  const navigate = useNavigate();
  const createNote = useAppStore((state) => state.createNote);
  return (
    <div className="editor-empty">
      <div className="editor-empty-mark"><PenLine size={21} /></div>
      <div className="editor-empty-title">{t('从这里开始。')}</div>
      <p className="editor-empty-text">{t('选择左侧的笔记，或写下此刻想到的第一句话。')}</p>
      <div className="editor-empty-actions editor-empty-actions-primary">
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            const note = await createNote();
            if (note) navigate(`/app/note/${note.id}`);
          }}
        >
          {t('新建笔记')}
        </button>
      </div>
      <div className="editor-empty-hints">
        <span><Check size={12} /> {t('自动保存')} · {t('离线可写')}</span>
        <span><Clock3 size={12} /> {t('历史版本与冲突副本')}</span>
        <span><FileText size={12} /> {t('Markdown 随时导出')}</span>
      </div>
      <div className="editor-empty-actions editor-empty-actions-secondary">
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/app/settings/data?import=1')}>
          <UploadCloud size={13} /> {t('导入笔记')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => window.dispatchEvent(new Event('nh:open-templates'))}>
          <LayoutTemplate size={13} /> {t('从模板创建')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true }))}>
          {t('打开命令面板')} <kbd>{shortcutLabel('Mod+K')}</kbd>
        </button>
      </div>
    </div>
  );
}
