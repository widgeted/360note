import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Clock3,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Hash,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Settings,
  Star,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import type { Folder, Tag } from '@360note/shared';
import { useAppStore, type NoteFilter } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { getLocale, useT } from '../lib/i18n';
import { cn } from '../lib/utils';
import { Avatar } from './Avatar';
import { LogoLockup } from './Logo';
import { Dropdown, MenuItem } from './Dropdown';
import { Modal } from './Modal';
import { NotificationCenter } from './NotificationCenter';
import { api } from '../lib/api';
import { toast } from '../stores/toast';

/**
 * A lightweight inline name field. Enter/blob commits, Escape cancels, and
 * the surrounding row keeps its own geometry so no modal is needed for
 * creating a folder or tag.
 */
function InlineNameInput({
  initialValue = '',
  placeholder,
  onSubmit,
  onCancel,
}: {
  initialValue?: string;
  placeholder: string;
  onSubmit: (value: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const settled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function commit() {
    if (settled.current) return;
    const trimmed = value.trim();
    if (!trimmed) {
      settled.current = true;
      onCancel();
      return;
    }
    settled.current = true;
    setSaving(true);
    const ok = await onSubmit(trimmed);
    if (!ok) {
      settled.current = false;
      setSaving(false);
      inputRef.current?.focus();
    }
  }

  return (
    <input
      ref={inputRef}
      className="inline-name-input"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      maxLength={80}
      autoFocus
      disabled={saving}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (!settled.current) void commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          settled.current = true;
          onCancel();
        }
      }}
    />
  );
}

export function Sidebar() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const workspaces = useAuthStore((state) => state.workspaces);
  const logout = useAuthStore((state) => state.logout);
  const setWorkspaces = useAuthStore((state) => state.setWorkspaces);
  const workspaceId = useAppStore((state) => state.workspaceId);
  const folders = useAppStore((state) => state.folders);
  const tags = useAppStore((state) => state.tags);
  const total = useAppStore((state) => state.total);
  const filter = useAppStore((state) => state.filter);
  const folderId = useAppStore((state) => state.folderId);
  const tagId = useAppStore((state) => state.tagId);
  const collapsed = useAppStore((state) => state.sidebarCollapsed);
  const mobileOpen = useAppStore((state) => state.sidebarMobileOpen);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const setMobileSidebar = useAppStore((state) => state.setMobileSidebar);
  const setFilter = useAppStore((state) => state.setFilter);
  const initialize = useAppStore((state) => state.initialize);
  const createNote = useAppStore((state) => state.createNote);
  const refreshFolders = useAppStore((state) => state.refreshFolders);
  const refreshTags = useAppStore((state) => state.refreshTags);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const folderTreeRef = useRef<HTMLDivElement>(null);
  const tagListRef = useRef<HTMLDivElement>(null);
  const [editingFolder, setEditingFolder] = useState<{ id?: string; name: string; parentId?: string | null } | null>(null);
  const [editingTag, setEditingTag] = useState<{ id?: string; name: string } | null>(null);
  const [deleteNode, setDeleteNode] = useState<{ kind: 'folder' | 'tag'; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const currentWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
  const settingsActive = location.pathname.startsWith('/app/settings');

  useEffect(() => {
    const roots = folders.filter((folder) => folder.parentId === null).map((folder) => folder.id);
    setExpanded((current) => {
      if (current.size) return current;
      return new Set(roots);
    });
  }, [folders]);

  function closeMobile() {
    setMobileSidebar(false);
  }

  async function selectFilter(next: NoteFilter, opts?: { folderId?: string | null; tagId?: string | null }) {
    navigate('/app');
    await setFilter(next, opts);
    closeMobile();
  }

  async function switchWorkspace(id: string) {
    if (id === workspaceId) return;
    localStorage.setItem('nh-workspace', id);
    await initialize(id);
    navigate('/app');
    closeMobile();
  }

  async function newNote() {
    const note = await createNote();
    if (note) navigate(`/app/note/${note.id}`);
    closeMobile();
  }

  async function saveFolder(name: string, id?: string): Promise<boolean> {
    if (!workspaceId || !name.trim()) return false;
    try {
      if (id) await api.patch(`/api/folders/${id}`, { name: name.trim() });
      else {
        const parentId = editingFolder?.parentId ?? null;
        await api.post('/api/folders', { workspaceId, name: name.trim(), parentId });
        if (parentId) setExpanded((current) => new Set(current).add(parentId));
      }
      await refreshFolders();
      setEditingFolder(null);
      return true;
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
      return false;
    }
  }

  async function saveTag(name: string, id?: string): Promise<boolean> {
    if (!workspaceId || !name.trim()) return false;
    try {
      if (id) await api.patch(`/api/tags/${id}`, { name: name.trim() });
      else await api.post('/api/tags', { workspaceId, name: name.trim() });
      await refreshTags();
      setEditingTag(null);
      return true;
    } catch (error) {
      toast('error', t('保存失败'), (error as Error).message);
      return false;
    }
  }

  function startCreateFolder(parentId: string | null = null) {
    setEditingTag(null);
    setEditingFolder({ name: '', parentId });
    if (parentId) setExpanded((current) => new Set(current).add(parentId));
    requestAnimationFrame(() => {
      if (parentId) return;
      folderTreeRef.current?.scrollTo({ top: 0 });
    });
  }

  function startCreateTag() {
    setEditingFolder(null);
    setEditingTag({ name: '' });
    requestAnimationFrame(() => tagListRef.current?.scrollTo({ top: 0 }));
  }

  async function confirmDelete() {
    if (!deleteNode) return;
    setBusy(true);
    try {
      if (deleteNode.kind === 'folder') {
        await api.delete(`/api/folders/${deleteNode.id}`);
        if (filter === 'folder' && folderId === deleteNode.id) await setFilter('all');
      } else {
        await api.delete(`/api/tags/${deleteNode.id}`);
        if (filter === 'tag' && tagId === deleteNode.id) await setFilter('all');
      }
      await Promise.all([refreshFolders(), refreshTags()]);
      setDeleteNode(null);
    } catch (error) {
      toast('error', t('删除失败'), (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function renderFolders(parentId: string | null, depth = 0): ReactNode {
    return folders
      .filter((folder) => folder.parentId === parentId)
      .map((folder) => {
        const children = folders.filter((item) => item.parentId === folder.id);
        const isOpen = expanded.has(folder.id);
        if (editingFolder?.id === folder.id) {
          return (
            <div key={folder.id} className="tree-folder expanded">
              <div className="tree-folder-row is-editing" style={{ paddingLeft: 6 + depth * 9 }}>
                <span className="tree-chevron">
                  {children.length > 0 ? <ChevronDown size={12} /> : <span style={{ width: 12 }} />}
                </span>
                {isOpen ? <FolderOpen size={13} /> : <FolderClosed size={13} />}
                <InlineNameInput
                  initialValue={editingFolder.name}
                  placeholder={t('文件夹名称')}
                  onSubmit={(value) => saveFolder(value, folder.id)}
                  onCancel={() => setEditingFolder(null)}
                />
              </div>
              {isOpen && children.length > 0 && <div className="tree-children">{renderFolders(folder.id, depth + 1)}</div>}
            </div>
          );
        }
        return (
          <div key={folder.id} className={cn('tree-folder', isOpen && 'expanded')}>
            <div
              className={cn('tree-folder-row', filter === 'folder' && folderId === folder.id && 'active')}
              style={{ paddingLeft: 6 + depth * 9 }}
              onClick={() => {
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(folder.id)) next.delete(folder.id);
                  else next.add(folder.id);
                  return next;
                });
                void selectFilter('folder', { folderId: folder.id });
              }}
              role="button"
              tabIndex={0}
              aria-label={folder.name}
              aria-expanded={children.length > 0 ? isOpen : undefined}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(folder.id)) next.delete(folder.id);
                    else next.add(folder.id);
                    return next;
                  });
                  void selectFilter('folder', { folderId: folder.id });
                }
              }}
            >
              <span className="tree-chevron">
                {children.length > 0 ? isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : <span style={{ width: 12 }} />}
              </span>
              {isOpen ? <FolderOpen size={13} /> : <FolderClosed size={13} />}
              <span className="tree-folder-name">{folder.name}</span>
              {folder.noteCount ? <span className="tree-folder-count">{folder.noteCount}</span> : null}
              <Dropdown
                trigger={
                  <button type="button" className="sidebar-section-action" aria-label={t('{name}的更多操作', { name: folder.name })}>
                    <MoreHorizontal size={13} />
                  </button>
                }
              >
                {(close) => (
                  <>
                    <MenuItem
                      icon={<Plus size={14} />}
                      onClick={() => {
                        close();
                        startCreateFolder(folder.id);
                      }}
                    >
                      {t('新建子文件夹')}
                    </MenuItem>
                    <MenuItem
                      icon={<Pencil size={14} />}
                      onClick={() => {
                        close();
                        setEditingTag(null);
                        setEditingFolder({ id: folder.id, name: folder.name });
                      }}
                    >
                      {t('重命名')}
                    </MenuItem>
                    <div className="menu-separator" />
                    <MenuItem
                      danger
                      icon={<Trash2 size={14} />}
                      onClick={() => {
                        close();
                        setDeleteNode({ kind: 'folder', id: folder.id, name: folder.name });
                      }}
                    >
                      {t('删除文件夹')}
                    </MenuItem>
                  </>
                )}
              </Dropdown>
            </div>
            {isOpen && (children.length > 0 || (!editingFolder?.id && editingFolder?.parentId === folder.id)) && (
              <div className="tree-children">
                {renderFolders(folder.id, depth + 1)}
                {!editingFolder?.id && editingFolder?.parentId === folder.id && (
                  <div className="tree-folder-row is-editing" style={{ paddingLeft: 6 + (depth + 1) * 9 }}>
                    <span className="tree-chevron"><span style={{ width: 12 }} /></span>
                    <FolderPlus size={13} />
                    <InlineNameInput
                      placeholder={t('子文件夹名称')}
                      onSubmit={(value) => saveFolder(value)}
                      onCancel={() => setEditingFolder(null)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      });
  }

  return (
    <>
      {mobileOpen && <div className="sidebar-scrim" onClick={closeMobile} />}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Link to="/app" aria-label={getLocale() === 'zh-CN' ? '360笔记' : '360note'} onClick={closeMobile}>
            <LogoLockup />
          </Link>
          <div className="sidebar-brand-actions">
            <NotificationCenter />
            <button
              type="button"
              className="sidebar-collapse"
              onClick={toggleSidebar}
              aria-label={t(collapsed ? '展开侧栏' : '收起侧栏')}
              title={t(collapsed ? '展开侧栏' : '收起侧栏')}
            >
              {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
            <button
              type="button"
              className="sidebar-collapse"
              onClick={closeMobile}
              aria-label={t('关闭侧栏')}
              style={{ display: mobileOpen ? 'grid' : 'none' }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <Dropdown
          align={collapsed ? 'start' : 'end'}
          width={collapsed ? 'auto' : 'trigger'}
          className="workspace-menu"
          trigger={
            <button type="button" className="workspace-switcher">
              <span
                className="workspace-mark"
                style={{
                  background: `${currentWorkspace?.color ?? '#17865b'}24`,
                  borderColor: `${currentWorkspace?.color ?? '#17865b'}40`,
                  color: currentWorkspace?.color ?? 'var(--sidebar-accent)',
                }}
              >
                {currentWorkspace?.icon ?? '📔'}
              </span>
              <span className="workspace-name">{currentWorkspace?.name ?? '360note'}</span>
              <span
                className="workspace-kind-icon"
                title={currentWorkspace?.kind === 'team' ? t('团队空间') : t('个人空间')}
                aria-label={currentWorkspace?.kind === 'team' ? t('团队空间') : t('个人空间')}
              >
                {currentWorkspace?.kind === 'team' ? <UsersRound size={13} /> : <UserRound size={13} />}
              </span>
              <ChevronDown size={13} className="workspace-chevron" />
            </button>
          }
        >
          {(close) => (
            <>
              <div className="menu-label">{t('空间')}</div>
              {workspaces.map((workspace) => (
                <MenuItem
                  key={workspace.id}
                  icon={
                    <span
                      className="workspace-mark"
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 6,
                        fontSize: 13,
                        background: `${workspace.color ?? '#17865b'}24`,
                        borderColor: `${workspace.color ?? '#17865b'}40`,
                        color: workspace.color ?? 'var(--sidebar-accent)',
                      }}
                    >
                      {workspace.icon ?? '📔'}
                    </span>
                  }
                  detail={workspace.id === workspaceId ? '✓' : undefined}
                  onClick={() => {
                    close();
                    void switchWorkspace(workspace.id);
                  }}
                >
                  {workspace.name}
                </MenuItem>
              ))}
              <div className="menu-separator" />
              <MenuItem
                icon={<Settings size={14} />}
                onClick={() => {
                  close();
                  navigate('/app/settings/team');
                }}
              >
                {t('管理空间')}
              </MenuItem>
              <MenuItem
                icon={<Plus size={14} />}
                onClick={() => {
                  close();
                  navigate('/app/settings/team?create=1');
                }}
              >
                {t('创建空间')}
              </MenuItem>
            </>
          )}
        </Dropdown>

        <div className="sidebar-nav">
          <button type="button" className={cn('nav-item', !settingsActive && filter === 'all' && 'active')} aria-current={!settingsActive && filter === 'all' ? 'page' : undefined} onClick={() => void selectFilter('all')}>
            <Archive size={15} />
            <span className="nav-label">{t('全部笔记')}</span>
            <span className="nav-count">{total}</span>
          </button>
          <button type="button" className={cn('nav-item', !settingsActive && filter === 'recent' && 'active')} aria-current={!settingsActive && filter === 'recent' ? 'page' : undefined} onClick={() => void selectFilter('recent')}>
            <Clock3 size={15} />
            <span className="nav-label">{t('最近编辑')}</span>
          </button>
          <button type="button" className={cn('nav-item', !settingsActive && filter === 'favorites' && 'active')} aria-current={!settingsActive && filter === 'favorites' ? 'page' : undefined} onClick={() => void selectFilter('favorites')}>
            <Star size={15} />
            <span className="nav-label">{t('收藏')}</span>
          </button>
          <button type="button" className={cn('nav-item', !settingsActive && filter === 'trash' && 'active')} aria-current={!settingsActive && filter === 'trash' ? 'page' : undefined} onClick={() => void selectFilter('trash')}>
            <Trash2 size={15} />
            <span className="nav-label">{t('回收站')}</span>
          </button>
        </div>

        <div className="sidebar-library app-scroll">
          <div className="sidebar-section">
            <span className="sidebar-section-label">{t('文件夹')}</span>
            <button
              type="button"
              className="sidebar-section-action"
              onClick={() => startCreateFolder(null)}
              aria-label={t('新建文件夹')}
            >
              <FolderPlus size={13} />
            </button>
          </div>
          <div className="sidebar-tree" ref={folderTreeRef}>
            {editingFolder && !editingFolder.id && !editingFolder.parentId && (
              <div className="tree-folder-row is-editing" style={{ paddingLeft: 6 }}>
                <span className="tree-chevron"><span style={{ width: 12 }} /></span>
                <FolderPlus size={13} />
                <InlineNameInput
                  placeholder={t('文件夹名称')}
                  onSubmit={(value) => saveFolder(value)}
                  onCancel={() => setEditingFolder(null)}
                />
              </div>
            )}
            {folders.length ? (
              renderFolders(null)
            ) : !editingFolder || editingFolder.parentId ? (
              <div className="sidebar-empty">{t('还没有文件夹')}</div>
            ) : null}
          </div>

          <div className="sidebar-section">
            <span className="sidebar-section-label">{t('标签')}</span>
            <button
              type="button"
              className="sidebar-section-action"
              onClick={startCreateTag}
              aria-label={t('新建标签')}
            >
              <Plus size={13} />
            </button>
          </div>
          <div ref={tagListRef} className="tag-scroll">
            {editingTag || tags.length ? (
              <div className="tag-cloud">
                {editingTag && !editingTag.id && (
                  <div className="tag-edit-row">
                    <span className="tag-hash" style={{ color: 'var(--sidebar-muted)' }}>#</span>
                    <InlineNameInput
                      placeholder={t('标签名称')}
                      onSubmit={(value) => saveTag(value)}
                      onCancel={() => setEditingTag(null)}
                    />
                  </div>
                )}
                {tags.slice(0, 30).map((tag) =>
                  editingTag?.id === tag.id ? (
                    <div className="tag-edit-row" key={tag.id}>
                      <span className="tag-hash" style={{ color: 'var(--sidebar-muted)' }}>#</span>
                      <InlineNameInput
                        initialValue={editingTag.name}
                        placeholder={t('标签名称')}
                        onSubmit={(value) => saveTag(value, tag.id)}
                        onCancel={() => setEditingTag(null)}
                      />
                    </div>
                  ) : (
                    <div className="tag-chip" key={tag.id}>
                      <button
                        type="button"
                        className={cn('tag-chip-main', !settingsActive && filter === 'tag' && tagId === tag.id && 'active')}
                        aria-current={!settingsActive && filter === 'tag' && tagId === tag.id ? 'page' : undefined}
                        onClick={() => void selectFilter('tag', { tagId: tag.id })}
                        title={`#${tag.name}`}
                      >
                        <span className="tag-hash" style={{ color: tag.color ?? 'var(--sidebar-muted)' }}>#</span>
                        <span className="tag-chip-name">{tag.name}</span>
                        <span className="tag-chip-count">{tag.noteCount ?? 0}</span>
                      </button>
                      <Dropdown
                        trigger={
                          <button type="button" className="tag-chip-more" aria-label={t('{name}的更多操作', { name: tag.name })}>
                            <MoreHorizontal size={11} />
                          </button>
                        }
                      >
                        {(close) => (
                          <>
                            <MenuItem
                              icon={<Pencil size={14} />}
                              onClick={() => {
                                close();
                                setEditingFolder(null);
                                setEditingTag({ id: tag.id, name: tag.name });
                              }}
                            >
                              {t('重命名')}
                            </MenuItem>
                            <MenuItem
                              danger
                              icon={<Trash2 size={14} />}
                              onClick={() => {
                                close();
                                setDeleteNode({ kind: 'tag', id: tag.id, name: tag.name });
                              }}
                            >
                              {t('删除标签')}
                            </MenuItem>
                          </>
                        )}
                      </Dropdown>
                    </div>
                  ),
                )}
              </div>
            ) : (
              <div className="sidebar-empty">{t('还没有标签')}</div>
            )}
          </div>
        </div>

        <div className="sidebar-footer" style={{ marginTop: 'auto' }}>
          <div className="sidebar-user">
            <Avatar name={user?.displayName ?? 'N'} color={user?.avatarColor} size="sm" />
            <span className="sidebar-user-meta">
              <span className="sidebar-user-name">{user?.displayName}</span>
              <span className="sidebar-user-sub">{user?.email}</span>
            </span>
            <Dropdown
              trigger={
                <button type="button" className="sidebar-user-more" aria-label={t('账户菜单')} title={t('账户菜单')}>
                  <MoreHorizontal size={14} />
                </button>
              }
            >
              {(close) => (
                <>
                <MenuItem
                  icon={<Settings size={14} />}
                  onClick={() => {
                    const state = location.pathname.startsWith('/app/settings')
                      ? location.state
                      : { from: location.pathname + location.search };
                    close();
                    navigate('/app/settings/account', { state });
                    closeMobile();
                  }}
                >
                  {t('设置')}
                </MenuItem>
                <div className="menu-separator" />
                <MenuItem
                  danger
                  icon={<LogOut size={14} />}
                  onClick={async () => {
                    close();
                    await logout();
                    navigate('/login');
                  }}
                >
                  {t('退出登录')}
                </MenuItem>
                <MenuItem
                  danger
                  icon={<Trash2 size={14} />}
                  onClick={async () => {
                    close();
                    if (!window.confirm(t('退出并清除本机数据会删除本机离线缓存和未同步草稿，且无法恢复。确定继续？'))) return;
                    await logout({ clearLocalData: true });
                    navigate('/login');
                  }}
                >
                  {t('退出并清除本机数据')}
                </MenuItem>
                </>
              )}
            </Dropdown>
          </div>
        </div>
      </aside>

      <Modal
        open={Boolean(deleteNode)}
        onClose={() => setDeleteNode(null)}
        title={deleteNode?.kind === 'folder' ? t('删除文件夹？') : t('删除标签？')}
        description={
          deleteNode?.kind === 'folder'
            ? t('文件夹中的笔记也会进入回收站。')
            : t('标签会从所有笔记上移除，笔记本身不会删除。')
        }
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDeleteNode(null)}>{t('取消')}</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={confirmDelete} disabled={busy}>
              {busy && <span className="spinner" />} {t('删除')}
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{deleteNode?.name}</p>
      </Modal>
    </>
  );
}
