import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownUp,
  Check,
  CheckSquare,
  FilePlus2,
  Loader2,
  MoreHorizontal,
  PanelLeftOpen,
  Pin,
  PinOff,
  RotateCcw,
  Search,
  Star,
  StarOff,
  XCircle,
  Trash2,
  X,
} from 'lucide-react';
import type { NoteSummary } from '@360note/shared';
import { useAppStore } from '../stores/app';
import { useT } from '../lib/i18n';
import { cn, formatNoteDate, shortcutLabel } from '../lib/utils';
import { ConfirmDialog } from './Modal';
import { Dropdown, MenuItem } from './Dropdown';
import { toast } from '../stores/toast';

const SORT_LABELS: Record<string, string> = {
  updated: '按更新时间',
  created: '按创建时间',
  title: '按标题',
  opened: '按最近打开',
};

export function NoteListPane() {
  const t = useT();
  const navigate = useNavigate();
  const notes = useAppStore((state) => state.notes);
  const total = useAppStore((state) => state.total);
  const currentNote = useAppStore((state) => state.note);
  const loading = useAppStore((state) => state.loadingList);
  const filter = useAppStore((state) => state.filter);
  const folderId = useAppStore((state) => state.folderId);
  const tagId = useAppStore((state) => state.tagId);
  const folders = useAppStore((state) => state.folders);
  const tags = useAppStore((state) => state.tags);
  const query = useAppStore((state) => state.query);
  const sort = useAppStore((state) => state.sort);
  const setQuery = useAppStore((state) => state.setQuery);
  const setSort = useAppStore((state) => state.setSort);
  const refreshList = useAppStore((state) => state.refreshList);
  const loadMore = useAppStore((state) => state.loadMore);
  const hasMore = useAppStore((state) => state.hasMore);
  const createNote = useAppStore((state) => state.createNote);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const togglePinned = useAppStore((state) => state.togglePinned);
  const restoreNote = useAppStore((state) => state.restoreNote);
  const deletePermanently = useAppStore((state) => state.deletePermanently);
  const emptyTrash = useAppStore((state) => state.emptyTrash);
  const batchAction = useAppStore((state) => state.batchAction);
  const setMobileSidebar = useAppStore((state) => state.setMobileSidebar);
  const [searchValue, setSearchValue] = useState(query);
  const [creating, setCreating] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NoteSummary | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    setSearchValue(query);
  }, [query]);

  useEffect(() => {
    function focusSearch() {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener('nh:focus-search', focusSearch);
    return () => window.removeEventListener('nh:focus-search', focusSearch);
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (searchValue === query) return;
    debounceRef.current = window.setTimeout(() => {
      setQuery(searchValue);
      void refreshList();
    }, 240);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [searchValue, query, setQuery, refreshList]);

  useEffect(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, [filter, folderId, tagId, query]);

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const folder = folders.find((entry) => entry.id === folderId);
  const tag = tags.find((entry) => entry.id === tagId);

  const heading = query.trim()
    ? t('搜索结果')
    : filter === 'trash'
      ? t('回收站')
      : filter === 'favorites'
        ? t('收藏')
        : filter === 'recent'
          ? t('最近编辑')
          : filter === 'folder'
            ? folder?.name ?? t('文件夹')
            : filter === 'tag'
              ? `#${tag?.name ?? ''}`
              : t('全部笔记');

  async function newNote() {
    setCreating(true);
    try {
      const note = await createNote({
        folderId: filter === 'folder' ? folderId : null,
        tagNames: filter === 'tag' && tag ? [tag.name] : undefined,
      });
      if (note) navigate(`/app/note/${note.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function restoreSelected() {
    if (!selectedIds.size) return;
    await batchAction('restore', [...selectedIds]);
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  function clearSearch() {
    setSearchValue('');
    setQuery('');
    void refreshList();
    inputRef.current?.focus();
  }

  const pinned = notes.filter((note) => note.isPinned);
  const normal = notes.filter((note) => !note.isPinned);

  return (
    <section className="list-pane">
      <div className="list-top">
        <div className="list-search-row">
          <button
            type="button"
            className="icon-btn icon-btn-sm mobile-menu-btn"
            onClick={() => setMobileSidebar(true)}
            aria-label={t('打开导航')}
            title={t('打开导航')}
          >
            <PanelLeftOpen size={16} />
          </button>
          <div className="search-trigger" style={{ padding: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0, padding: '0 10px' }}>
              <Search size={14} style={{ flex: 'none' }} />
              <input
                ref={inputRef}
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    clearSearch();
                    inputRef.current?.blur();
                  }
                  if (event.key === 'Enter') {
                    setQuery(searchValue);
                    void refreshList();
                  }
                }}
                placeholder={t('搜索笔记、标签或附件')}
                aria-label={t('搜索')}
                style={{
                  border: 0,
                  outline: 'none',
                  background: 'transparent',
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  color: 'var(--text)',
                }}
              />
              {searchValue ? (
                <button type="button" className="icon-btn icon-btn-sm" onClick={clearSearch} aria-label={t('清除搜索')} style={{ width: 20, height: 20 }}>
                  <X size={12} />
                </button>
              ) : (
                <kbd>{shortcutLabel('Mod+K')}</kbd>
              )}
            </div>
          </div>
          <button type="button" className="new-note-btn" onClick={newNote} disabled={creating} title={t('新建笔记')} aria-label={t('新建笔记')}>
            {creating ? <span className="spinner" style={{ width: 15, height: 15 }} /> : <FilePlus2 size={16} />}
          </button>
        </div>

        <div className="list-heading">
          <h1>
            {heading}
            <span className="list-count">{loading ? '…' : total}</span>
          </h1>
          <div className="list-actions">
            {notes.length > 0 && (
              <button
                type="button"
                className={cn('icon-btn icon-btn-sm', selectionMode && 'active')}
                onClick={() => { setSelectionMode((value) => !value); setSelectedIds(new Set()); }}
                title={selectionMode ? t('取消选择') : t('批量选择')}
                aria-label={selectionMode ? t('取消选择') : t('批量选择')}
              >
                <CheckSquare size={14} />
              </button>
            )}
            {filter === 'trash' && notes.length > 0 && (
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => setConfirmEmpty(true)} title={t('清空回收站')} aria-label={t('清空回收站')}>
                <Trash2 size={14} />
              </button>
            )}
            <Dropdown
              trigger={
                <button type="button" className="icon-btn icon-btn-sm" title={t('排序')} aria-label={t('排序')}>
                  <ArrowDownUp size={14} />
                </button>
              }
            >
              {(close) => (
                <>
                  <div className="menu-label">{t('排序')}</div>
                  {Object.entries(SORT_LABELS).map(([value, label]) => (
                    <MenuItem
                      key={value}
                      detail={sort === value ? '✓' : undefined}
                      onClick={() => {
                        close();
                        setSort(value as typeof sort);
                      }}
                    >
                      {t(label)}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
          </div>
        </div>
      </div>

      {selectionMode && (
        <div className="selection-bar">
          <span className="selection-count">{selectedIds.size ? t('已选择 {n} 项', { n: selectedIds.size }) : t('批量操作')}</span>
          <div style={{ flex: 1 }} />
          {filter === 'trash' ? (
            <button type="button" className="btn btn-secondary btn-sm" disabled={!selectedIds.size} onClick={() => void restoreSelected()}>
              <RotateCcw size={12} /> {t('恢复所选')}
            </button>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" disabled={!selectedIds.size} onClick={() => void batchAction('trash', [...selectedIds]).then(() => { setSelectedIds(new Set()); setSelectionMode(false); })}>
              <Trash2 size={12} /> {t('删除所选')}
            </button>
          )}
          {filter === 'trash' && (
            <button type="button" className="btn btn-danger-ghost btn-sm" disabled={!selectedIds.size} onClick={() => setBatchDeleteOpen(true)}>
              <Trash2 size={12} /> {t('永久删除')}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSelectedIds(new Set()); setSelectionMode(false); }}>
            <XCircle size={12} /> {t('取消选择')}
          </button>
        </div>
      )}

      <div className="list-body app-scroll">
        {loading && notes.length === 0 && <ListSkeleton />}

        {!loading && notes.length === 0 && (
          <div className="list-empty">
            <div className="list-empty-icon">
              {query ? <Search size={17} /> : filter === 'trash' ? <Trash2 size={17} /> : <FilePlus2 size={17} />}
            </div>
            <div className="list-empty-title">
              {query
                ? t('没有匹配的笔记')
                : filter === 'trash'
                  ? t('回收站是空的')
                  : filter === 'favorites'
                    ? t('还没有收藏')
                    : filter === 'folder'
                      ? t('此文件夹还没有笔记')
                      : t('暂无笔记')}
            </div>
            <div className="list-empty-text">
              {query
                ? t('试试标题、正文、标签或附件名中的另一个关键词。')
                : filter === 'trash'
                  ? t('已删除的笔记会保留 30 天')
                  : filter === 'favorites'
                    ? t('点击笔记右侧的星标即可收藏。')
                    : t('从这里开始记录第一个想法')}
            </div>
            {filter !== 'trash' && (
              <div className="list-empty-actions">
                {query && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSearchValue('');
                      setQuery('');
                    }}
                  >
                    <X size={13} /> {t('清除搜索')}
                  </button>
                )}
                <button type="button" className="btn btn-primary btn-sm" onClick={newNote}>
                  <FilePlus2 size={13} /> {t('新建笔记')}
                </button>
              </div>
            )}
          </div>
        )}

        {pinned.length > 0 && <div className="note-list-group-label">{t('置顶')}</div>}
        {pinned.map((note) => (
          <NoteItem
            key={note.id}
            note={note}
            trash={filter === 'trash'}
            selectionMode={selectionMode}
            selected={selectedIds.has(note.id)}
            active={currentNote?.id === note.id}
            onToggleSelect={() => toggleSelected(note.id)}
            onOpen={() => navigate(`/app/note/${note.id}`)}
            onFavorite={() => void toggleFavorite(note.id)}
            onPin={() => void togglePinned(note.id)}
            onRestore={() => void restoreNote(note.id).then(() => undefined)}
            onDelete={() => setDeleteTarget(note)}
          />
        ))}
        {pinned.length > 0 && normal.length > 0 && <div className="note-list-group-label">{t('其他笔记')}</div>}
        {normal.map((note) => (
          <NoteItem
            key={note.id}
            note={note}
            trash={filter === 'trash'}
            selectionMode={selectionMode}
            selected={selectedIds.has(note.id)}
            active={currentNote?.id === note.id}
            onToggleSelect={() => toggleSelected(note.id)}
            onOpen={() => navigate(`/app/note/${note.id}`)}
            onFavorite={() => void toggleFavorite(note.id)}
            onPin={() => void togglePinned(note.id)}
            onRestore={() => void restoreNote(note.id).then(() => undefined)}
            onDelete={() => setDeleteTarget(note)}
          />
        ))}

        {notes.length > 0 && (
          <div className="list-end">
            {hasMore ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadMore()} disabled={loading}>
                {loading ? <span className="spinner" /> : null}
                {t('加载更多')} · {notes.length}/{total}
              </button>
            ) : (
              t('共 {n} 篇笔记', { n: total })
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        onConfirm={async () => {
          await emptyTrash();
          setConfirmEmpty(false);
          toast('success', t('回收站已清空'));
        }}
        title={t('确定清空回收站吗？')}
        description={t('回收站中的所有笔记将被永久删除。')}
        confirmLabel={t('清空回收站')}
        danger
      />

      <ConfirmDialog
        open={batchDeleteOpen}
        onClose={() => setBatchDeleteOpen(false)}
        onConfirm={async () => {
          await batchAction('delete', [...selectedIds]);
          setSelectedIds(new Set());
          setSelectionMode(false);
          setBatchDeleteOpen(false);
        }}
        title={t('永久删除所选笔记？')}
        description={t('此操作无法撤销，附件也会被删除。')}
        confirmLabel={t('永久删除')}
        danger
      >
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('已选择 {n} 项', { n: selectedIds.size })}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deletePermanently(deleteTarget.id);
          setDeleteTarget(null);
        }}
        title={t('确定要永久删除吗？')}
        description={t('此操作无法撤销，附件也会被删除。')}
        confirmLabel={t('永久删除')}
        danger
      >
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{deleteTarget?.title}</p>
      </ConfirmDialog>
    </section>
  );
}

function NoteItem({
  note,
  trash,
  selectionMode,
  selected,
  active,
  onToggleSelect,
  onOpen,
  onFavorite,
  onPin,
  onRestore,
  onDelete,
}: {
  note: NoteSummary;
  trash: boolean;
  selectionMode: boolean;
  selected: boolean;
  active: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onFavorite: () => void;
  onPin: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <div
      className={cn('note-item', selected && 'selected', active && 'active')}
      role="button"
      tabIndex={0}
      onClick={selectionMode ? onToggleSelect : onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (selectionMode) onToggleSelect();
          else onOpen();
        }
      }}
    >
      <div className="note-item-top">
        {selectionMode && (
          <span className={cn('note-check', selected && 'checked')} aria-hidden="true">
            {selected && <Check size={11} />}
          </span>
        )}
        {note.isPinned && <Pin size={11} className="note-item-pin" />}
        {note.isFavorite && !note.isPinned && <Star size={11} className="note-item-star" />}
        <div className="note-item-title">{note.title || t('未命名笔记')}</div>
      </div>
      {note.excerpt && <div className="note-item-excerpt">{note.excerpt}</div>}
      <div className="note-item-meta">
        <span className="note-item-date">{formatNoteDate(note.updatedAt)}</span>
        {note.tags.length > 0 && (
          <>
            <span className="dot" />
            <div className="note-item-tags">
              {note.tags.slice(0, 2).map((tag) => (
                <span className="mini-tag" key={tag.id}>#{tag.name}</span>
              ))}
              {note.tags.length > 2 && <span className="mini-tag">+{note.tags.length - 2}</span>}
            </div>
          </>
        )}
      </div>
      {!selectionMode && <div className="note-item-quick-actions" onClick={(event) => event.stopPropagation()}>
        {trash ? (
          <>
            <button type="button" className="quick-icon-btn" onClick={onRestore} title={t('恢复')} aria-label={t('恢复')}>
              <RotateCcw size={13} />
            </button>
            <button type="button" className="quick-icon-btn" onClick={onDelete} title={t('永久删除')} aria-label={t('永久删除')}>
              <Trash2 size={13} />
            </button>
          </>
        ) : (
          <>
            <button type="button" className="quick-icon-btn" onClick={onFavorite} title={note.isFavorite ? t('取消收藏') : t('收藏')} aria-label={note.isFavorite ? t('取消收藏') : t('收藏')}>
              {note.isFavorite ? <StarOff size={13} /> : <Star size={13} />}
            </button>
            <button type="button" className="quick-icon-btn" onClick={onPin} title={note.isPinned ? t('取消置顶') : t('置顶')} aria-label={note.isPinned ? t('取消置顶') : t('置顶')}>
              {note.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
            </button>
          </>
        )}
      </div>}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 7 }).map((_, index) => (
        <div className="note-item-skeleton" key={index}>
          <div className="skeleton-line" style={{ width: `${55 + ((index * 13) % 30)}%`, marginBottom: 8 }} />
          <div className="skeleton-line" style={{ width: '92%', marginBottom: 5, height: 7 }} />
          <div className="skeleton-line" style={{ width: '65%', height: 7 }} />
        </div>
      ))}
    </div>
  );
}
