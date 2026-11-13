import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { useAppStore } from '../stores/app';
import { getLocale, useT } from '../lib/i18n';
import { Sidebar } from '../components/Sidebar';
import { NoteListPane } from '../components/NoteListPane';
import { ContextPanel } from '../components/ContextPanel';
import { CommandPalette } from '../components/CommandPalette';
import { PwaInstallPrompt } from '../components/PwaInstallPrompt';
import { EmptyEditorState } from '../components/editor/EmptyEditorState';
import { SplitNotePreview } from '../components/editor/SplitNotePreview';
const EditorPane = lazy(() => import('../components/editor/EditorPane').then((module) => ({ default: module.EditorPane })));
const SettingsPage = lazy(() => import('./SettingsPage'));
import { Modal } from '../components/Modal';
import { api } from '../lib/api';
import { applyCustomTemplate, type CustomTemplate } from '../lib/templates';
import { cn } from '../lib/utils';
import { useMediaQuery } from '../lib/useMediaQuery';
import { toast } from '../stores/toast';

export default function AppPage() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const workspaces = useAuthStore((state) => state.workspaces);
  const user = useAuthStore((state) => state.user);
  const workspaceId = useAppStore((state) => state.workspaceId);
  const initializedWorkspace = useAppStore((state) => state.initializedWorkspace);
  const note = useAppStore((state) => state.note);
  const loadingNote = useAppStore((state) => state.loadingNote);
  const initialize = useAppStore((state) => state.initialize);
  const openNote = useAppStore((state) => state.openNote);
  const closeNote = useAppStore((state) => state.closeNote);
  const createNote = useAppStore((state) => state.createNote);
  const reloadTick = useAppStore((state) => state.reloadTick);
  const contextOpen = useAppStore((state) => state.contextOpen);
  const setContextOpen = useAppStore((state) => state.setContextOpen);
  const setContextTab = useAppStore((state) => state.setContextTab);
  const setCommandOpen = useAppStore((state) => state.setCommandOpen);
  const commandOpen = useAppStore((state) => state.commandOpen);
  const focusMode = useAppStore((state) => state.focusMode);
  const setFocusMode = useAppStore((state) => state.setFocusMode);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const sidebarMobileOpen = useAppStore((state) => state.sidebarMobileOpen);
  const setMobileSidebar = useAppStore((state) => state.setMobileSidebar);
  const [showTemplates, setShowTemplates] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const canSplit = useMediaQuery('(min-width: 1280px)');
  const [splitEnabled, setSplitEnabled] = useState(() => canSplit && localStorage.getItem('nh-split-enabled') === '1');
  const [splitOtherId, setSplitOtherId] = useState<string | null>(() => localStorage.getItem('nh-split-other'));
  const [splitActivePane, setSplitActivePane] = useState<0 | 1>(0);
  const [awaitingReference, setAwaitingReference] = useState(false);
  const flushSplitRef = useRef<(() => Promise<void>) | null>(null);
  const lastActiveNoteRef = useRef<string | null>(null);
  const pendingReferenceNoteRef = useRef<string | null>(null);
  const initialSplitCheckDone = useRef(false);
  const collapsedBySplitRef = useRef(false);
  const newNoteGuard = useRef(false);
  const autoOpenedNote = useRef<string | null>(null);

  async function loadTemplates() {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const response = await api.get<{ templates: CustomTemplate[] }>('/api/templates');
      setCustomTemplates(response.templates);
    } catch (error) {
      setTemplatesError((error as Error).message);
    } finally {
      setTemplatesLoading(false);
      setTemplatesLoaded(true);
    }
  }

  useEffect(() => {
    void loadTemplates();
  }, []);

  useEffect(() => {
    if (showTemplates) void loadTemplates();
  }, [showTemplates]);

  const settingsMode = location.pathname.startsWith('/app/settings');
  const settingsSection = location.pathname.match(/^\/app\/settings\/([^/]+)/)?.[1] ?? 'account';
  const noteId = location.pathname.match(/^\/app\/note\/([^/]+)/)?.[1] ?? null;
  useEffect(() => {
    if (location.pathname.startsWith('/app/settings')) return;
    if (location.pathname.includes('/app/note/')) return;
    const brand = getLocale() === 'zh-CN' ? '360笔记' : '360note';
    document.title = `${t('全部笔记')} — ${brand}`;
  }, [location.pathname, t]);
  useEffect(() => {
    // Authenticated application surfaces are never SEO landing pages.
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'robots';
      document.head.appendChild(meta);
    }
    meta.content = 'noindex, nofollow';
  }, []);


  const isNewRoute = location.pathname === '/app/new';
  const requestedPanel = new URLSearchParams(location.search).get('panel');

  useEffect(() => {
    if (!workspaces.length) return;
    const stored = localStorage.getItem('nh-workspace');
    const valid =
      workspaces.find((workspace) => workspace.id === stored) ??
      workspaces.find((workspace) => workspace.kind === 'personal') ??
      workspaces[0];
    if (valid && (workspaceId !== valid.id || initializedWorkspace !== valid.id)) {
      void initialize(valid.id);
    }
  }, [workspaces, workspaceId, initializedWorkspace, initialize]);

  useEffect(() => {
    if (!note || !requestedPanel) return;
    if (requestedPanel === 'comments' || requestedPanel === 'history' || requestedPanel === 'backlinks' || requestedPanel === 'info') {
      setContextTab(requestedPanel);
    }
  }, [note?.id, requestedPanel, setContextTab]);

  useEffect(() => {
    localStorage.setItem('nh-split-enabled', splitEnabled ? '1' : '0');
    if (splitOtherId) localStorage.setItem('nh-split-other', splitOtherId);
    else localStorage.removeItem('nh-split-other');
  }, [splitEnabled, splitOtherId]);

  useEffect(() => {
    if (initialSplitCheckDone.current) return;
    initialSplitCheckDone.current = true;
    if (splitEnabled && splitOtherId && splitOtherId === noteId) {
      setSplitOtherId(null);
      setAwaitingReference(true);
    }
  }, [splitEnabled, splitOtherId, noteId]);

  useEffect(() => {
    if (canSplit || !splitEnabled) return;
    setSplitEnabled(false);
    setSplitOtherId(null);
    setAwaitingReference(false);
    setSplitActivePane(0);
    if (collapsedBySplitRef.current) {
      collapsedBySplitRef.current = false;
      if (useAppStore.getState().sidebarCollapsed) toggleSidebar();
    }
    toast('info', t('屏幕较窄，已关闭未聚焦的笔记'));
  }, [canSplit, splitEnabled, t, toggleSidebar]);

  useEffect(() => {
    if (!initializedWorkspace) return;
    if (noteId) {
      const previous = lastActiveNoteRef.current;
      if (pendingReferenceNoteRef.current && noteId !== pendingReferenceNoteRef.current) {
        pendingReferenceNoteRef.current = null;
      }
      if (pendingReferenceNoteRef.current === noteId) {
        return;
      }
      if (splitEnabled && awaitingReference && previous && noteId !== previous) {
        pendingReferenceNoteRef.current = noteId;
        setSplitOtherId(noteId);
        setAwaitingReference(false);
        navigate(`/app/note/${previous}`, { replace: true });
        return;
      }
      if (splitEnabled && splitOtherId === noteId && previous && previous !== noteId) {
        setSplitOtherId(previous);
        setSplitActivePane((pane) => (pane === 0 ? 1 : 0));
      }
      lastActiveNoteRef.current = noteId;
      if (autoOpenedNote.current !== noteId) {
        autoOpenedNote.current = noteId;
        void openNote(noteId);
      }
    } else {
      autoOpenedNote.current = null;
      lastActiveNoteRef.current = null;
      if (splitEnabled) {
        setSplitEnabled(false);
        setSplitOtherId(null);
        setAwaitingReference(false);
        setSplitActivePane(0);
      }
      if (!settingsMode && note) closeNote();
    }
  }, [noteId, initializedWorkspace, openNote, closeNote, settingsMode, note, splitEnabled, splitOtherId, awaitingReference, navigate]);

  function toggleSplit() {
    if (!canSplit) return;
    if (splitEnabled) {
      setSplitEnabled(false);
      setSplitOtherId(null);
      setAwaitingReference(false);
      setSplitActivePane(0);
      if (collapsedBySplitRef.current) {
        collapsedBySplitRef.current = false;
        if (useAppStore.getState().sidebarCollapsed) toggleSidebar();
      }
      return;
    }
    setSplitEnabled(true);
    setSplitActivePane(0);
    const currentId = noteId;
    const existing = splitOtherId && splitOtherId !== currentId ? splitOtherId : null;
    const candidate = existing ?? useAppStore.getState().notes.find((entry) => entry.id !== currentId)?.id ?? null;
    setSplitOtherId(candidate);
    setAwaitingReference(!candidate);
    if (!useAppStore.getState().sidebarCollapsed) {
      collapsedBySplitRef.current = true;
      toggleSidebar();
    }
  }

  async function focusOtherNote() {
    if (!splitOtherId) {
      setAwaitingReference(true);
      return;
    }
    await flushSplitRef.current?.();
    navigate(`/app/note/${splitOtherId}`);
  }

  useEffect(() => {
    if (!isNewRoute || !initializedWorkspace || newNoteGuard.current) return;
    newNoteGuard.current = true;
    void createNote().then((created) => {
      newNoteGuard.current = false;
      if (created) navigate(`/app/note/${created.id}`, { replace: true });
    });
  }, [isNewRoute, initializedWorkspace, createNote, navigate]);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      const element = target as HTMLElement | null;
      return Boolean(
        element &&
          (element.tagName === 'INPUT' ||
            element.tagName === 'TEXTAREA' ||
            element.isContentEditable),
      );
    }
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(!useAppStore.getState().commandOpen);
        return;
      }
      if (mod && event.key.toLowerCase() === 'n' && !event.shiftKey) {
        event.preventDefault();
        void createNote().then((created) => {
          if (created) navigate(`/app/note/${created.id}`);
        });
        return;
      }
      if (mod && (event.key === '\\' || event.code === 'Backslash')) {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (mod && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        if (useAppStore.getState().note) setContextOpen(!useAppStore.getState().contextOpen);
        return;
      }
      if (event.key === 'Escape') {
        if (useAppStore.getState().focusMode) {
          setFocusMode(false);
          return;
        }
        if (useAppStore.getState().sidebarMobileOpen) {
          setMobileSidebar(false);
          return;
        }
        if (useAppStore.getState().contextOpen && window.innerWidth <= 1240) {
          setContextOpen(false);
          return;
        }
      }
      if (!isTypingTarget(event.target) && event.key === '/') {
        event.preventDefault();
        window.dispatchEvent(new Event('nh:focus-search'));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createNote, navigate, setCommandOpen, setContextOpen, setFocusMode, setMobileSidebar, toggleSidebar]);

  useEffect(() => {
    function openTemplates() {
      setShowTemplates(true);
    }
    function onLocalSynced(event: Event) {
      const detail = (event as CustomEvent<{ localId: string; newId: string }>).detail;
      if (!detail) return;
      if (window.location.pathname.includes(detail.localId)) {
        navigate(`/app/note/${detail.newId}`, { replace: true });
      }
    }
    window.addEventListener('nh:open-templates', openTemplates);
    window.addEventListener('nh:local-note-synced', onLocalSynced);
    return () => {
      window.removeEventListener('nh:open-templates', openTemplates);
      window.removeEventListener('nh:local-note-synced', onLocalSynced);
    };
  }, [navigate]);

  useEffect(() => {
    function onFocus() {
      if (!navigator.onLine) return;
      const state = useAppStore.getState();
      if (state.workspaceId && !state.loadingList) {
        void state.refreshList({ silent: true });
        const current = state.note;
        if (current && !current.id.startsWith('local-')) {
          void state.reloadNote();
        }
      }
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  async function useCustomTemplate(template: CustomTemplate) {
    const currentWorkspace = workspaces.find((entry) => entry.id === workspaceId);
    const resolved = applyCustomTemplate(template, {
      user: user?.displayName ?? '',
      workspace: currentWorkspace?.name ?? '',
    });
    const created = await createNote({
      title: resolved.title,
      contentMd: resolved.contentMd,
    });
    setShowTemplates(false);
    if (created) navigate(`/app/note/${created.id}`);
  }

  const showEditor = Boolean(noteId);
  const appClass = cn(
    'app-root',
    useAppStore((state) => state.sidebarCollapsed) && 'sidebar-collapsed',
    showEditor && 'has-note',
    focusMode && 'focus-mode',
    sidebarMobileOpen && 'sidebar-open',
  );

  return (
    <div className={appClass}>
      <Sidebar />
      {settingsMode ? (
        <Suspense fallback={<div className="page-shell"><div className="editor-empty"><span className="spinner spinner-lg" /></div></div>}>
          <SettingsPage section={settingsSection} />
        </Suspense>
      ) : (
        <>
          <NoteListPane />
          <main className="main-pane">
            {showEditor ? (
              note && note.id === noteId ? (
                splitEnabled && canSplit ? (
                  <div className={cn('split-workspace', splitActivePane === 1 && 'active-right')}>
                    {splitActivePane === 0 ? (
                      <>
                        <div className="split-pane split-pane-active">
                          <Suspense fallback={<div className="editor-empty"><span className="spinner spinner-lg" /></div>}>
                            <EditorPane
                              key={note.id}
                              noteId={note.id}
                              reloadTick={reloadTick}
                              onMobileBack={() => navigate('/app')}
                              splitEnabled={splitEnabled}
                              canSplit={canSplit}
                              onToggleSplit={toggleSplit}
                              onRegisterFlush={(flush) => { flushSplitRef.current = flush; }}
                            />
                          </Suspense>
                        </div>
                        <SplitNotePreview
                          noteId={splitOtherId}
                          awaiting={awaitingReference}
                          onFocus={() => void focusOtherNote()}
                          onChoose={() => setAwaitingReference(true)}
                        />
                      </>
                    ) : (
                      <>
                        <SplitNotePreview
                          noteId={splitOtherId}
                          awaiting={awaitingReference}
                          onFocus={() => void focusOtherNote()}
                          onChoose={() => setAwaitingReference(true)}
                        />
                        <div className="split-pane split-pane-active">
                          <Suspense fallback={<div className="editor-empty"><span className="spinner spinner-lg" /></div>}>
                            <EditorPane
                              key={note.id}
                              noteId={note.id}
                              reloadTick={reloadTick}
                              onMobileBack={() => navigate('/app')}
                              splitEnabled={splitEnabled}
                              canSplit={canSplit}
                              onToggleSplit={toggleSplit}
                              onRegisterFlush={(flush) => { flushSplitRef.current = flush; }}
                            />
                          </Suspense>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <Suspense fallback={<div className="editor-empty"><span className="spinner spinner-lg" /></div>}>
                    <EditorPane
                      key={note.id}
                      noteId={note.id}
                      reloadTick={reloadTick}
                      onMobileBack={() => navigate('/app')}
                      splitEnabled={splitEnabled}
                      canSplit={canSplit}
                      onToggleSplit={toggleSplit}
                    />
                  </Suspense>
                )
              ) : loadingNote ? (
                <div className="editor-empty">
                  <span className="spinner spinner-lg" />
                  <p className="editor-empty-text" style={{ marginTop: 14 }}>{t('正在加载…')}</p>
                </div>
              ) : (
                <div className="editor-empty">
                  <div className="editor-empty-mark"><FileText size={22} /></div>
                  <div className="editor-empty-title">{t('找不到这篇笔记')}</div>
                  <p className="editor-empty-text">{t('它可能已被删除，或你没有访问权限。')}</p>
                  <div className="editor-empty-actions">
                    <button type="button" className="btn btn-primary" onClick={() => navigate('/app')}>{t('返回我的笔记')}</button>
                  </div>
                </div>
              )
            ) : (
              <EmptyEditorState />
            )}
          </main>
          {note && (
            <>
              <div className={cn('context-scrim', contextOpen && 'is-open')} onClick={() => setContextOpen(false)} />
              <ContextPanel />
            </>
          )}
        </>
      )}

      <CommandPalette />
      <PwaInstallPrompt />
      <Modal
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        title={t('从模板创建')}
        description={t('模板只是起点。创建后可以自由修改。')}
        size="md"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(!templatesLoaded || templatesLoading) && customTemplates.length === 0 ? (
            <div className="loading-row"><span className="spinner" /> {t('正在加载模板…')}</div>
          ) : templatesError && customTemplates.length === 0 ? (
            <div className="form-error">
              {templatesError}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadTemplates()}>{t('重试')}</button>
            </div>
          ) : customTemplates.length === 0 ? (
            <div className="context-empty">{t('还没有模板。可以到模板设置新建，或稍后重试。')}</div>
          ) : (
            customTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="backlink-item"
                onClick={() => void useCustomTemplate(template)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px' }}
              >
                <span className="feature-icon" style={{ margin: 0, width: 30, height: 30 }}><FileText size={14} /></span>
                <span style={{ flex: 1 }}>
                  <span className="backlink-title">{template.name}</span>
                  <span className="backlink-excerpt">{template.description || t('模板')}</span>
                </span>
                {template.builtinKey && <span className="badge badge-gray">{t('默认')}</span>}
                <Plus size={14} style={{ color: 'var(--text-tertiary)' }} />
              </button>
            ))
          )}
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setShowTemplates(false); navigate('/app/settings/templates'); }}>
            {t('管理模板')}
          </button>
        </div>
      </Modal>

      <div className="visually-hidden" aria-live="polite">
        {commandOpen ? t('命令面板已打开') : ''}
      </div>
    </div>
  );
}
