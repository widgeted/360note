import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { useAppStore } from '../stores/app';
import { getLocale, useT } from '../lib/i18n';
import { Sidebar } from '../components/Sidebar';
import { NoteListPane } from '../components/NoteListPane';
import { ContextPanel } from '../components/ContextPanel';
import { CommandPalette } from '../components/CommandPalette';
import { EditorPane, EmptyEditorState } from '../components/editor/EditorPane';
import SettingsPage from './SettingsPage';
import { Modal } from '../components/Modal';
import { toast } from '../stores/toast';
import { cn } from '../lib/utils';

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
  const newNoteGuard = useRef(false);
  const autoOpenedNote = useRef<string | null>(null);

  const settingsMode = location.pathname.startsWith('/app/settings');
  const settingsSection = location.pathname.match(/^\/app\/settings\/([^/]+)/)?.[1] ?? 'account';
  const noteId = location.pathname.match(/^\/app\/note\/([^/]+)/)?.[1] ?? null;
  useEffect(() => {
    if (location.pathname.startsWith('/app/settings')) return;
    if (location.pathname.includes('/app/note/')) return;
    const brand = getLocale() === 'zh-CN' ? '360笔记' : '360note';
    document.title = `${t('全部笔记')} — ${brand}`;
  }, [location.pathname, t]);

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
    if (!initializedWorkspace) return;
    if (noteId) {
      if (autoOpenedNote.current !== noteId) {
        autoOpenedNote.current = noteId;
        void openNote(noteId);
      }
    } else {
      autoOpenedNote.current = null;
      if (!settingsMode && note) closeNote();
    }
  }, [noteId, initializedWorkspace, openNote, closeNote, settingsMode, note]);

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

  async function useTemplate(template: 'meeting' | 'daily' | 'project') {
    const zh = getLocale() === 'zh-CN';
    const content =
      template === 'meeting'
        ? zh
          ? `# 会议记录 · ${new Date().toLocaleDateString('zh-CN')}\n\n**参与人：**\n\n**目标：**\n\n## 议程\n\n1. \n\n## 讨论\n\n- \n\n## 决定\n\n- \n\n## 行动项\n\n- [ ] \n`
          : `# Meeting notes · ${new Date().toLocaleDateString('en-US')}\n\n**Attendees:**\n\n**Goal:**\n\n## Agenda\n\n1. \n\n## Discussion\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n`
        : template === 'daily'
          ? zh
            ? `# ${new Date().toLocaleDateString('zh-CN')} · 日记\n\n## 今天发生了什么\n\n\n## 想法\n\n\n## 明天\n\n- [ ] \n`
            : `# ${new Date().toLocaleDateString('en-US')} · Daily note\n\n## What happened\n\n\n## Thoughts\n\n\n## Tomorrow\n\n- [ ] \n`
          : zh
            ? `# 项目简报\n\n**一句话目标：**\n\n**为什么现在做：**\n\n## 范围\n\n- 包含：\n- 不包含：\n\n## 里程碑\n\n| 日期 | 交付物 | 负责人 |\n| --- | --- | --- |\n|  |  |  |\n\n## 风险\n\n- \n`
            : `# Project brief\n\n**One-line goal:**\n\n**Why now:**\n\n## Scope\n\n- In:\n- Out:\n\n## Milestones\n\n| Date | Deliverable | Owner |\n| --- | --- | --- |\n|  |  |  |\n\n## Risks\n\n- \n`;
    const created = await createNote({ title: template === 'meeting' ? t('会议记录') : template === 'daily' ? t('日报') : t('项目简报'), contentMd: content });
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
        <SettingsPage section={settingsSection} />
      ) : (
        <>
          <NoteListPane />
          <main className="main-pane">
            {showEditor ? (
              note && note.id === noteId ? (
                <EditorPane
                  key={note.id}
                  noteId={note.id}
                  reloadTick={reloadTick}
                  onMobileBack={() => navigate('/app')}
                />
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
          {note && contextOpen && (
            <>
              <div className="context-scrim" onClick={() => setContextOpen(false)} />
              <ContextPanel />
            </>
          )}
        </>
      )}

      <CommandPalette />
      <Modal
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        title={t('从模板创建')}
        description={t('模板只是起点。创建后可以自由修改。')}
        size="md"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { id: 'meeting' as const, title: t('会议记录'), desc: t('议程、讨论、决定与行动项') },
            { id: 'daily' as const, title: t('日报'), desc: t('今天发生了什么、想法与明天') },
            { id: 'project' as const, title: t('项目简报'), desc: t('目标、范围、里程碑与风险') },
          ].map((template) => (
            <button
              key={template.id}
              type="button"
              className="backlink-item"
              onClick={() => void useTemplate(template.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px' }}
            >
              <span className="feature-icon" style={{ margin: 0, width: 30, height: 30 }}><FileText size={14} /></span>
              <span style={{ flex: 1 }}>
                <span className="backlink-title">{template.title}</span>
                <span className="backlink-excerpt">{template.desc}</span>
              </span>
              <Plus size={14} style={{ color: 'var(--text-tertiary)' }} />
            </button>
          ))}
        </div>
      </Modal>

      <div className="visually-hidden" aria-live="polite">
        {commandOpen ? t('命令面板已打开') : ''}
      </div>
    </div>
  );
}
