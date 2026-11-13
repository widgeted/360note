import { useEffect, useState } from 'react';
import type { NoteSummary } from '@360note/shared';
import { Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useAppStore } from '../../stores/app';
import { useT } from '../../lib/i18n';
import { formatNoteDate } from '../../lib/utils';
import { Modal } from '../Modal';

export function ReferenceNotePicker({
  open,
  onClose,
  activeNoteId,
  referenceNoteId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  activeNoteId: string | null;
  referenceNoteId: string | null;
  onSelect: (noteId: string) => void;
}) {
  const t = useT();
  const workspaceId = useAppStore((state) => state.workspaceId);
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;
    let live = true;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      api.get<{ notes: NoteSummary[] }>(
        `/api/notes?workspaceId=${workspaceId}&filter=all&sort=updated&limit=30&q=${encodeURIComponent(query.trim())}`,
      )
        .then((response) => {
          if (!live) return;
          setNotes(response.notes.filter((note) => note.id !== activeNoteId));
        })
        .catch((cause: Error) => {
          if (live) setError(cause.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 220);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [open, workspaceId, query, activeNoteId]);

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('选择参考笔记')}
      description={t('选择一篇最近的笔记作为只读参考；不会改变当前编辑的笔记。')}
      size="md"
    >
      <div className="field">
        <label>{t('搜索笔记')}</label>
        <div className="reference-picker-search">
          <Search size={14} />
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('搜索标题、摘要或标签…')}
            autoFocus
          />
        </div>
      </div>
      <div className="reference-picker-list">
        {loading ? (
          <div className="loading-row"><span className="spinner" /> {t('正在加载最近笔记…')}</div>
        ) : error ? (
          <div className="form-error">{error}</div>
        ) : notes.length === 0 ? (
          <div className="context-empty">{query.trim() ? t('没有匹配的笔记') : t('还没有其他笔记，可以先新建一篇。')}</div>
        ) : notes.map((note) => {
          const isReference = note.id === referenceNoteId;
          return (
            <button
              key={note.id}
              type="button"
              className="reference-picker-item"
              onClick={() => onSelect(note.id)}
              disabled={isReference}
            >
              <span className="reference-picker-main">
                <span className="reference-picker-title">{note.title || t('未命名笔记')}</span>
                {note.excerpt && <span className="reference-picker-excerpt">{note.excerpt}</span>}
                <span className="reference-picker-meta">
                  {formatNoteDate(note.updatedAt)}
                  {note.tags.slice(0, 2).map((tag) => <span key={tag.id}>#{tag.name}</span>)}
                </span>
              </span>
              {isReference && <span className="badge badge-blue">{t('当前参考')}</span>}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
