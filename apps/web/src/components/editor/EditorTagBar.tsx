import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../stores/app';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';
import { toast } from '../../stores/toast';

export function EditorTagBar() {
  const t = useT();
  const note = useAppStore((state) => state.note);
  const tags = useAppStore((state) => state.tags);
  const updateNoteMeta = useAppStore((state) => state.updateNoteMeta);
  const refreshTags = useAppStore((state) => state.refreshTags);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!note) return null;

  const readOnly = !note.canEdit || Boolean(note.trashedAt);
  if (readOnly && note.tags.length === 0) return null;
  const selected = new Set(note.tags.map((tag) => tag.id));
  const suggestions = tags
    .filter((tag) => !selected.has(tag.id))
    .filter((tag) => !query.trim() || tag.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8);

  async function addTag(tagId: string) {
    setBusy(true);
    try {
      await updateNoteMeta({ tagIds: [...note!.tags.map((tag) => tag.id), tagId] });
      setOpen(false);
      setQuery('');
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createTag() {
    const name = query.trim();
    if (!name) return;
    setBusy(true);
    try {
      const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        await addTag(existing.id);
        return;
      }
      const response = await api.post<{ tag: { id: string } }>('/api/tags', {
        workspaceId: note!.workspaceId,
        name,
      });
      await refreshTags();
      await addTag(response.tag.id);
    } catch (error) {
      toast('error', t('创建标签失败'), (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(tagId: string) {
    await updateNoteMeta({ tagIds: note!.tags.filter((tag) => tag.id !== tagId).map((tag) => tag.id) });
  }

  return (
    <div className="editor-tag-section">
      <div className="editor-tag-bar" aria-label={t('标签')}>
        {note.tags.map((tag) => (
          <span className="tag-token" key={tag.id}>
            <span className="tag-hash">#</span>
            <span className="tag-token-name">{tag.name}</span>
            {!readOnly && (
              <button type="button" onClick={() => void removeTag(tag.id)} aria-label={t('移除')} title={t('移除')}>
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <button
            type="button"
            className="tag-token tag-token-add"
            onClick={() => {
              setOpen((value) => !value);
              window.setTimeout(() => inputRef.current?.focus(), 20);
            }}
            aria-expanded={open}
          >
            <span className="tag-hash">#</span> {t('添加标签')}
          </button>
        )}
      </div>

      {open && !readOnly && (
        <div className="editor-tag-popover">
          <div className="editor-tag-input-row">
            <input
              ref={inputRef}
              className="input input-sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('标签名称')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void createTag();
                }
                if (event.key === 'Escape') setOpen(false);
              }}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void createTag()} disabled={busy || !query.trim()}>
              {t('添加')}
            </button>
          </div>
          {suggestions.length > 0 && (
            <div className="editor-tag-suggestions">
              {suggestions.map((tag) => (
                <button type="button" className="tag-token tag-token-select" key={tag.id} onClick={() => void addTag(tag.id)} disabled={busy}>
                  <span className="tag-hash">#</span> {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
