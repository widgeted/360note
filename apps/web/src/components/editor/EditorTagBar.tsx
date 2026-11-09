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
  const [editing, setEditing] = useState(false);
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

  function focusInput() {
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }

  async function addTag(tagId: string) {
    if (!note) return;
    setBusy(true);
    try {
      await updateNoteMeta({ tagIds: [...note.tags.map((tag) => tag.id), tagId] });
      setQuery('');
      focusInput();
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commitInput() {
    if (!note || !query.trim()) {
      if (!query.trim()) setEditing(false);
      return;
    }
    const name = query.trim();
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      await addTag(existing.id);
      return;
    }
    setBusy(true);
    try {
      const response = await api.post<{ tag: { id: string } }>('/api/tags', {
        workspaceId: note.workspaceId,
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
    if (!note) return;
    await updateNoteMeta({ tagIds: note.tags.filter((tag) => tag.id !== tagId).map((tag) => tag.id) });
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
          editing ? (
            <span className="tag-token tag-token-edit">
              <span className="tag-hash">#</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void commitInput();
                  }
                  if (event.key === 'Escape') {
                    setEditing(false);
                    setQuery('');
                  }
                }}
                onBlur={() => {
                  if (query.trim()) void commitInput();
                  else setEditing(false);
                }}
                placeholder={t('添加标签')}
                aria-label={t('添加标签')}
                disabled={busy}
              />
            </span>
          ) : (
            <button
              type="button"
              className="tag-token tag-token-add"
              onClick={() => {
                setEditing(true);
                focusInput();
              }}
            >
              <span className="tag-hash">#</span> {t('添加标签')}
            </button>
          )
        )}
      </div>

      {editing && suggestions.length > 0 && (
        <div className="editor-tag-suggestions">
          {suggestions.map((tag) => (
            <button
              type="button"
              className="tag-token tag-token-select"
              key={tag.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void addTag(tag.id)}
              disabled={busy}
            >
              <span className="tag-hash">#</span> {tag.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
