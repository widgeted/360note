import { useEffect, useState } from 'react';
import type { Note } from '@360note/shared';
import { BookOpen, Columns2, FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { renderMarkdown, stripDuplicateTitle } from '../../lib/markdown';
import { formatRelativeShort } from '../../lib/utils';
import { useT } from '../../lib/i18n';

export function SplitNotePreview({
  noteId,
  awaiting,
  onFocus,
  onChoose,
}: {
  noteId: string | null;
  awaiting: boolean;
  onFocus: () => void;
  onChoose: () => void;
}) {
  const t = useT();
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!noteId) {
      setNote(null);
      setError(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    api.get<{ note: Note }>(`/api/notes/${noteId}`)
      .then((response) => {
        if (live) setNote(response.note);
      })
      .catch((cause: Error) => {
        if (live) {
          setNote(null);
          setError(cause.message);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [noteId]);

  const html = note
    ? renderMarkdown(stripDuplicateTitle(note.contentMd, note.title), { wikiLinks: false }).html
    : '';

  return (
    <section className="split-pane split-pane-preview" aria-label={t('参考笔记')}>
      <header className="split-preview-head">
        <span className="split-preview-badge"><Columns2 size={12} /> {t('参考')}</span>
        <span className="split-preview-title" title={note?.title}>{note?.title || t('参考笔记')}</span>
        {note && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onChoose}>
            {t('更换')}
          </button>
        )}
        {note && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onFocus}>
            <BookOpen size={12} /> {t('编辑此篇')}
          </button>
        )}
      </header>
      <div className="split-preview-body app-scroll">
        {awaiting ? (
          <div className="split-preview-empty">
            <Columns2 size={26} />
            <strong>{t('选择参考笔记')}</strong>
            <p>{t('从左侧笔记列表选择一篇笔记；选中后会保持只读，点击“编辑此篇”即可切换编辑焦点。')}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onChoose}>{t('开始选择')}</button>
          </div>
        ) : loading ? (
          <div className="split-preview-empty"><span className="spinner" /> {t('正在加载参考笔记…')}</div>
        ) : error ? (
          <div className="split-preview-empty">
            <FileText size={26} />
            <strong>{t('无法加载参考笔记')}</strong>
            <p>{error}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onChoose}>{t('选择其他笔记')}</button>
          </div>
        ) : !note ? (
          <div className="split-preview-empty">
            <Columns2 size={26} />
            <strong>{t('还没有参考笔记')}</strong>
            <p>{t('从左侧笔记列表选择一篇笔记，右侧会显示只读参考。')}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onChoose}>{t('选择参考笔记')}</button>
          </div>
        ) : (
          <>
            {note.updatedAt && <div className="split-preview-meta">{t('最后编辑')} {formatRelativeShort(note.updatedAt)}</div>}
            <div className="prose split-preview-prose" dangerouslySetInnerHTML={{ __html: html }} />
          </>
        )}
      </div>
    </section>
  );
}
