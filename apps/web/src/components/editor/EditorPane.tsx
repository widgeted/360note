import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  FileCode2,
  FileText,
  History,
  Info,
  Link2,
  Loader2,
  Maximize2,
  Minimize2,
  Mic,
  MoreHorizontal,
  PanelRight,
  PenLine,
  Pin,
  PinOff,
  RotateCcw,
  Share2,
  Sparkles,
  Star,
  StarOff,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import { useAppStore, isLocalNote } from '../../stores/app';
import { useAuthStore } from '../../stores/auth';
import { useT, getLocale } from '../../lib/i18n';
import { useIsMobile } from '../../lib/useMediaQuery';
import {
  charCount,
  cn,
  copyText,
  formatFullDate,
  formatRelativeShort,
  shortcutLabel,
  untitledNoteTitle,
  wordCount,
} from '../../lib/utils';
import { api, downloadBlob } from '../../lib/api';
import { saveDraft, readDraft, clearDraft, type Draft } from '../../lib/offline';
import { escapeHtml } from '../../lib/utils';
import { markdownToEditorHtml, renderMarkdown, stripDuplicateTitle } from '../../lib/markdown';
import { Dropdown, MenuItem } from '../Dropdown';
import { ConfirmDialog, Modal } from '../Modal';
import { toast } from '../../stores/toast';
import { EditorToolbar } from './EditorToolbar';
import { TipTapEditor, type EditorHandle, type UploadedAttachment } from './TipTapEditor';
import { EditorTagBar } from './EditorTagBar';
import { ShareDialog } from './ShareDialog';
import { SummaryDialog } from './SummaryDialog';

export function EditorPane({
  noteId,
  reloadTick,
  onMobileBack,
}: {
  noteId: string;
  reloadTick: number;
  onMobileBack: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const note = useAppStore((state) => state.note);
  const folders = useAppStore((state) => state.folders);
  const notes = useAppStore((state) => state.notes);
  const workspaceId = useAppStore((state) => state.workspaceId);
  const syncState = useAppStore((state) => state.syncState);
  const syncMessage = useAppStore((state) => state.syncMessage);
  const conflictNoteId = useAppStore((state) => state.conflictNoteId);
  const clearConflict = useAppStore((state) => state.clearConflict);
  const pendingCount = useAppStore((state) => state.pendingCount);
  const contextOpen = useAppStore((state) => state.contextOpen);
  const setContextOpen = useAppStore((state) => state.setContextOpen);
  const setContextTab = useAppStore((state) => state.setContextTab);
  const saveNote = useAppStore((state) => state.saveNote);
  const updateNoteMeta = useAppStore((state) => state.updateNoteMeta);
  const trashNote = useAppStore((state) => state.trashNote);
  const restoreNote = useAppStore((state) => state.restoreNote);
  const duplicateNote = useAppStore((state) => state.duplicateNote);
  const reloadNote = useAppStore((state) => state.reloadNote);
  const setFilter = useAppStore((state) => state.setFilter);
  const focusMode = useAppStore((state) => state.focusMode);
  const isMobile = useIsMobile();
  const setFocusMode = useAppStore((state) => state.setFocusMode);
  const user = useAuthStore((state) => state.user);
  const instance = useAuthStore((state) => state.instance);
  const workspaces = useAuthStore((state) => state.workspaces);
  const currentWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);

  const [title, setTitle] = useState(note?.title ?? '');
  const [content, setContent] = useState(note ? stripDuplicateTitle(note.contentMd, note.title) : '');
  const [mode, setModeState] = useState<'rich' | 'markdown'>(
    user?.prefs?.defaultNoteFormat === 'markdown' ? 'markdown' : 'rich',
  );

  // The editing mode belongs to a single note. Switching Markdown/rich text in
  // one note must not change how other notes open. The preference in Settings
  // only supplies the default for notes that have never been opened before.
  useEffect(() => {
    if (!note?.id) return;
    const stored = localStorage.getItem(`nh-editor-mode:${note.id}`);
    if (stored === 'rich' || stored === 'markdown') setModeState(stored);
    else setModeState(user?.prefs?.defaultNoteFormat === 'markdown' ? 'markdown' : 'rich');
    // Only re-evaluate when the note changes; changing the default must not
    // flip the mode of a note that is already open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  function setMode(next: 'rich' | 'markdown') {
    if (note?.id) localStorage.setItem(`nh-editor-mode:${note.id}`, next);
    setModeState(next);
  }
  const [richSeed, setRichSeed] = useState(0);
  const [editorHandle, setEditorHandle] = useState<EditorHandle | null>(null);
  const editor = editorHandle?.editor ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [hasActiveShare, setHasActiveShare] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [showWiki, setShowWiki] = useState(false);
  const [wikiQuery, setWikiQuery] = useState('');
  const [showMove, setShowMove] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef(content);
  const titleValueRef = useRef(title);
  const baseVersionRef = useRef(note?.version ?? 0);
  const dirtyRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const draftTimer = useRef<number | null>(null);
  const saveNowRef = useRef<(reason?: 'auto' | 'manual') => Promise<void>>(async () => {});
  const voiceRef = useRef<{ stop: () => void } | null>(null);
  const lastReloadRef = useRef(reloadTick);

  contentRef.current = content;
  titleValueRef.current = title;

  useEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    const resize = () => {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [title]);

  useEffect(() => {
    if (!note) return;
    const fresh = useAppStore.getState().freshNoteId === note.id;
    setTitle(fresh ? '' : note.title);
    const normalized = stripDuplicateTitle(note.contentMd, note.title);
    setContent(normalized);
    contentRef.current = normalized;
    titleValueRef.current = fresh ? '' : note.title;
    baseVersionRef.current = note.version;
    dirtyRef.current = false;
    setRichSeed((value) => value + 1);
    if (fresh) {
      useAppStore.setState({ freshNoteId: null });
      requestAnimationFrame(() => titleRef.current?.focus());
    }
    let active = true;
    readDraft(note.id).then((stored) => {
      if (!active || !stored) return;
      if (
        stored.updatedAt > new Date(note.updatedAt).getTime() + 1200 &&
        (stored.contentMd !== note.contentMd || stored.title !== note.title)
      ) {
        setDraft(stored);
      }
    });
    return () => {
      active = false;
    };
  }, [note?.id]);

  useEffect(() => {
    if (!note || reloadTick === lastReloadRef.current) return;
    lastReloadRef.current = reloadTick;
    // Never replace text under an active edit. The user's unsaved words win;
    // metadata saves no longer bump the document version, so this is rare.
    if (dirtyRef.current) return;
    const latest = useAppStore.getState().note;
    if (!latest || latest.id !== note.id) return;
    clearTimeout(saveTimer.current ?? undefined);
    setTitle(latest.title);
    const normalized = stripDuplicateTitle(latest.contentMd, latest.title);
    setContent(normalized);
    contentRef.current = normalized;
    titleValueRef.current = latest.title;
    baseVersionRef.current = latest.version;
    dirtyRef.current = false;
    setRichSeed((value) => value + 1);
    void clearDraft(latest.id);
  }, [reloadTick, note?.id]);

  useEffect(() => {
    if (note) baseVersionRef.current = note.version;
  }, [note?.version]);

  useEffect(() => {
    if (note) document.title = `${title || t('未命名笔记')} — ${getLocale() === 'zh-CN' ? '360笔记' : '360note'}`;
    return () => {
      document.title = getLocale() === 'zh-CN' ? '360笔记 — 把想法留下' : '360note — Keep ideas';
    };
  }, [title, note?.id, t]);

  useEffect(() => {
    if (!titleRef.current) return;
    titleRef.current.style.height = 'auto';
    titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
  }, [title]);

  useEffect(() => {
    function onWikiOpen(event: Event) {
      const title = (event as CustomEvent<{ title: string }>).detail?.title;
      if (!title) return;
      const normalized = title.trim().toLowerCase();
      const target = useAppStore
        .getState()
        .notes.find((entry) => entry.title.trim().toLowerCase() === normalized);
      if (target) {
        navigate(`/app/note/${target.id}`);
        return;
      }
      // The linked note may live outside the current filter. Resolve it
      // through search instead of silently doing nothing.
      if (!workspaceId) {
        toast('warning', t('找不到链接的笔记'), title);
        return;
      }
      void api
        .get<{ notes: Array<{ id: string; title: string }> }>(
          `/api/search?workspaceId=${encodeURIComponent(workspaceId)}&q=${encodeURIComponent(title)}&limit=20`,
        )
        .then((result) => {
          const match = result.notes.find((entry) => entry.title.trim().toLowerCase() === normalized);
          if (match) navigate(`/app/note/${match.id}`);
          else toast('warning', t('找不到链接的笔记'), title);
        })
        .catch(() => toast('warning', t('找不到链接的笔记'), title));
    }
    window.addEventListener('nh:open-wiki', onWikiOpen);
    return () => window.removeEventListener('nh:open-wiki', onWikiOpen);
  }, [navigate, t, workspaceId]);

  useEffect(() => {
    function onEditorAction(event: Event) {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (!action) return;
      if (action === 'share') {
        if (note?.canShare) setShowShare(true);
        else toast('warning', t('无法分享'), t('请先登录并确保你有分享权限。'));
      }
      if (action === 'history') setContextTab('history');
      if (action === 'summary') {
        if (instance?.aiEnabled) setShowSummary(true);
        else toast('info', t('AI 摘要未启用'), t('实例管理员尚未配置 AI。'));
      }
      if (action === 'focus') setFocusMode(true);
      if (action === 'export') setShowExport(true);
    }
    window.addEventListener('nh:editor-action', onEditorAction);
    return () => window.removeEventListener('nh:editor-action', onEditorAction);
  }, [note?.canShare, setContextTab, setFocusMode, t]);

  const saveNow = useCallback(
    async (reason: 'auto' | 'manual' = 'auto') => {
      if (!note || note.trashedAt || !note.canEdit) return;
      if (saveInFlightRef.current) {
        saveQueuedRef.current = true;
        return;
      }
      if (!dirtyRef.current && reason === 'auto') return;
      saveInFlightRef.current = true;
      try {
        const currentTitle = titleValueRef.current;
        const currentContent = contentRef.current;
        const effectiveTitle = currentTitle.trim() || untitledNoteTitle(note.createdAt);
        dirtyRef.current = false;
        const result = await saveNote({
          title: effectiveTitle,
          contentMd: currentContent,
          baseVersion: baseVersionRef.current,
          reason,
        });
        if (result.ok && result.note) {
          baseVersionRef.current = result.note.version;
          if (titleValueRef.current === currentTitle && contentRef.current === currentContent) {
            dirtyRef.current = false;
            await clearDraft(note.id);
          }
        } else if (!result.queued) {
          dirtyRef.current = true;
        }
      } finally {
        saveInFlightRef.current = false;
        if (saveQueuedRef.current) {
          saveQueuedRef.current = false;
          if (dirtyRef.current) {
            if (saveTimer.current) window.clearTimeout(saveTimer.current);
            saveTimer.current = window.setTimeout(() => {
              saveTimer.current = null;
              void saveNowRef.current('auto');
            }, 0);
          }
        }
      }
    },
    [note?.id, note?.canEdit, note?.trashedAt, saveNote],
  );
  saveNowRef.current = saveNow;

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveNowRef.current('auto');
    }, 800);
  }, []);

  const scheduleDraft = useCallback(() => {
    if (!note || !workspaceId) return;
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      draftTimer.current = null;
      void saveDraft({
        noteId: note.id,
        workspaceId,
        title: titleValueRef.current,
        contentMd: contentRef.current,
        baseVersion: baseVersionRef.current,
        updatedAt: Date.now(),
      });
    }, 280);
  }, [note?.id, workspaceId]);

  useEffect(() => {
    if (!note?.canShare || isLocalNote(note.id)) {
      setHasActiveShare(false);
      return;
    }
    let active = true;
    api.get<{ shares: Array<{ revokedAt: string | null }> }>(`/api/notes/${note.id}/shares`)
      .then((response) => {
        if (active) setHasActiveShare(response.shares.some((share) => !share.revokedAt));
      })
      .catch(() => {
        if (active) setHasActiveShare(false);
      });
    return () => {
      active = false;
    };
  }, [note?.id, note?.canShare, showShare]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveNowRef.current('manual');
        toast('success', t('已保存'));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [t]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (draftTimer.current) window.clearTimeout(draftTimer.current);
      if (voiceRef.current) voiceRef.current.stop();
      if (note && workspaceId && dirtyRef.current) {
        void saveDraft({
          noteId: note.id,
          workspaceId,
          title: titleValueRef.current,
          contentMd: contentRef.current,
          baseVersion: baseVersionRef.current,
          updatedAt: Date.now(),
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, workspaceId]);

  if (!note) {
    return <EmptyEditorState />;
  }

  const readOnly = !note.canEdit || Boolean(note.trashedAt);
  const words = wordCount(content);
  const chars = charCount(content);
  const readMinutes = Math.max(1, Math.round(words / 400));
  const canShare = note.canShare && !note.trashedAt && !isLocalNote(note.id);

  function applyTitle(next: string) {
    if (next === titleValueRef.current) return;
    setTitle(next);
    scheduleSave();
    scheduleDraft();
  }

  function applyContent(next: string) {
    if (next === contentRef.current) return;
    setContent(next);
    contentRef.current = next;
    scheduleSave();
    scheduleDraft();
  }

  async function toggleMode() {
    if (!note || readOnly) return;
    if (mode === 'rich') {
      await saveNowRef.current('manual');
      setMode('markdown');
    } else {
      setMode('rich');
      setRichSeed((value) => value + 1);
    }
  }

  async function restoreDraft() {
    if (!draft) return;
    setTitle(draft.title);
    const normalized = stripDuplicateTitle(draft.contentMd, draft.title);
    setContent(normalized);
    contentRef.current = normalized;
    titleValueRef.current = draft.title;
    baseVersionRef.current = draft.baseVersion;
    dirtyRef.current = true;
    setRichSeed((value) => value + 1);
    setDraft(null);
    scheduleSave();
    toast('info', t('草稿已恢复'), t('保存后就会同步到你的账户。'));
  }

  async function discardDraft() {
    if (!draft) return;
    await clearDraft(draft.noteId);
    setDraft(null);
  }

  function uploadAttachment(file: File, onProgress?: (percent: number) => void): Promise<UploadedAttachment> {
    if (!note || readOnly) return Promise.reject(new Error(t('当前无法上传附件')));
    if (isLocalNote(note.id) || !navigator.onLine) {
      return Promise.reject(new Error(t('离线时无法上传附件；联网后会恢复上传。')));
    }
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const unsupported = ['image/heic', 'image/heif', 'image/tiff', 'image/bmp'];
    if (unsupported.includes(file.type) || ['heic', 'heif', 'tif', 'tiff', 'bmp'].includes(extension)) {
      return Promise.reject(new Error(t('不支持 HEIC/HEIF 等图片格式，请使用 PNG、JPEG、WebP、GIF 或 AVIF')));
    }
    if (instance?.maxUploadBytes && file.size > instance.maxUploadBytes) {
      return Promise.reject(new Error(t('文件超过 {size} MB 的上传限制', { size: Math.round(instance.maxUploadBytes / 1024 / 1024) })));
    }
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/notes/${note.id}/attachments`);
      xhr.withCredentials = true;
      xhr.responseType = 'json';
      xhr.timeout = 10 * 60 * 1000;
      xhr.setRequestHeader('X-360note-CSRF', '1');
      let lastProgress = -1;
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        if (percent === lastProgress) return;
        lastProgress = percent;
        onProgress?.(percent);
      };
      xhr.onload = () => {
        const data = xhr.response as {
          attachment?: { id: string; filename: string; mime: string; url?: string };
          error?: { message?: string };
        } | null;
        if (xhr.status >= 200 && xhr.status < 300 && data?.attachment) {
          void reloadNote();
          resolve({
            id: data.attachment.id,
            filename: data.attachment.filename,
            mime: data.attachment.mime,
            url: data.attachment.url ?? `/api/attachments/${data.attachment.id}/content`,
          });
          return;
        }
        reject(new Error(data?.error?.message || t('上传失败（{status}）', { status: xhr.status })));
      };
      xhr.onerror = () => reject(new Error(t('网络错误，上传未完成')));
      xhr.ontimeout = () => reject(new Error(t('上传超时，请重试')));
      xhr.onabort = () => reject(new Error(t('上传已取消')));
      xhr.send(form);
    });
  }

  function openLinkDialog() {
    if (!editor) return;
    setLinkUrl(editor.getAttributes('link').href ?? '');
    setShowLink(true);
  }

  function applyLink() {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^(https?:|mailto:|#|\/)/i.test(url)) url = `https://${url}`;
    if (editor) {
      if (editor.state.selection.empty) {
        editor.chain().focus().insertContent(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`).run();
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      }
    } else {
      applyContent(`${contentRef.current}${contentRef.current.endsWith('\n') ? '' : '\n'}[${url}](${url})`);
    }
    setShowLink(false);
    setLinkUrl('');
  }

  function insertWikiLink(titleToInsert: string) {
    if (editor) editor.chain().focus().insertContent(`[[${titleToInsert}]]`).run();
    else applyContent(`${contentRef.current}${contentRef.current.endsWith('\n') ? '' : '\n'}[[${titleToInsert}]]`);
    setShowWiki(false);
    setWikiQuery('');
  }

  async function copyNoteLink() {
    if (isLocalNote(note!.id)) {
      toast('warning', t('离线笔记还没有链接'), t('联网同步后即可复制。'));
      return;
    }
    await copyText(`${window.location.origin}/app/note/${note!.id}`);
    toast('success', t('链接已复制'));
  }

  async function exportNote(format: 'md' | 'html' | 'pdf') {
    try {
      const extension = format;
      await downloadBlob(
        `/api/notes/${note!.id}/export?format=${format}`,
        `${note!.title || t('未命名笔记')}.${extension}`,
      );
    } catch (error) {
      toast('error', t('导出失败'), (error as Error).message);
    }
  }

  function startVoice() {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast('warning', t('此浏览器不支持语音输入'), t('可以试试 Chrome、Edge 或 Safari。'));
      return;
    }
    if (voiceRef.current) {
      voiceRef.current.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = getLocale() === 'en' ? 'en-US' : 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => {
      setVoiceActive(true);
      toast('info', t('正在聆听…'), t('说出你想写下的内容，完成后会自动插入。'));
    };
    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      const transcript = Array.from({ length: event.results.length }, (_, index) => event.results[index][0].transcript).join(' ');
      if (transcript) {
        if (editor) editor.chain().focus().insertContent(transcript).run();
        else applyContent(`${contentRef.current}${transcript}`);
      }
    };
    recognition.onerror = () => {
      setVoiceActive(false);
      toast('warning', t('没有听到内容'), t('请检查麦克风权限后重试。'));
    };
    recognition.onend = () => {
      setVoiceActive(false);
      voiceRef.current = null;
    };
    voiceRef.current = recognition;
    recognition.start();
  }

  function insertSummary(summary: string) {
    const addition = `\n\n## ${t('摘要')}\n\n${summary}\n`;
    if (editor) {
      editor.chain().focus().insertContent(markdownToEditorHtml(addition)).run();
    } else {
      applyContent(`${contentRef.current}${addition}`);
    }
  }

  const sortedFolders = useMemo(() => flattenFolders(folders), [folders]);
  const wikiResults = useMemo(() => {
    const needle = wikiQuery.trim().toLowerCase();
    return notes
      .filter((entry) => entry.id !== note.id)
      .filter((entry) => !needle || entry.title.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [notes, note.id, wikiQuery]);

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <button type="button" className="icon-btn mobile-back-btn" onClick={onMobileBack} aria-label={t('返回笔记')}>
          <ArrowLeft size={17} />
        </button>
        <div className="topbar-breadcrumb">
          <button type="button" className="breadcrumb-item" onClick={() => navigate('/app')} title={t('当前空间')}>
            {currentWorkspace?.name ?? t('全部笔记')}
          </button>
          {(note.folderPath ?? []).map((folder) => (
            <span key={folder.id} style={{ display: 'contents' }}>
              <ChevronRight size={11} className="breadcrumb-sep" />
              <button
                type="button"
                className="breadcrumb-item"
                onClick={() => {
                  navigate('/app');
                  void setFilter('folder', { folderId: folder.id });
                }}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </div>
        <div className="topbar-actions">
          <span className="topbar-save">
            <span className={cn('save-glyph', syncState === 'saving' && 'saving', (syncState === 'offline' || syncState === 'error') && syncState, syncState === 'error' && 'error')} />
            <span className="save-text">
              {syncState === 'saving'
                ? t('保存中…')
                : syncState === 'offline'
                  ? pendingCount
                    ? t('待同步', { n: pendingCount })
                    : t('离线')
                  : syncState === 'error'
                    ? t('保存失败')
                    : t('已保存')}
            </span>
          </span>
          <button
            type="button"
            className={cn('icon-btn hide-mobile', note.isFavorite && 'active')}
            onClick={() => void updateNoteMeta({ isFavorite: !note.isFavorite })}
            title={note.isFavorite ? t('取消收藏') : t('收藏')}
            aria-label={note.isFavorite ? t('取消收藏') : t('收藏')}
          >
            {note.isFavorite ? <Star size={16} fill="currentColor" /> : <Star size={16} />}
          </button>
          {canShare && (
            <button
              type="button"
              className={cn('icon-btn hide-mobile', hasActiveShare && 'share-active')}
              onClick={() => setShowShare(true)}
              title={hasActiveShare ? t('已创建分享链接') : t('分享')}
              aria-label={hasActiveShare ? t('已创建分享链接') : t('分享')}
            >
              <Share2 size={16} />
            </button>
          )}
          <button
            type="button"
            className={cn('icon-btn', contextOpen && 'active')}
            onClick={() => setContextOpen(!contextOpen)}
            title={t('显示信息面板')}
            aria-label={t('显示信息面板')}
          >
            <PanelRight size={16} />
          </button>
          <Dropdown
            trigger={
              <button type="button" className="icon-btn" aria-label={t('更多操作')} title={t('更多操作')}>
                <MoreHorizontal size={17} />
              </button>
            }
          >
            {(close) => (
              <>
                <div className="menu-label">{t('笔记操作')}</div>
                <MenuItem icon={note.isPinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={() => { close(); void updateNoteMeta({ isPinned: !note.isPinned }); }}>
                  {note.isPinned ? t('取消置顶') : t('置顶')}
                </MenuItem>
                <MenuItem icon={note.isFavorite ? <StarOff size={14} /> : <Star size={14} />} onClick={() => { close(); void updateNoteMeta({ isFavorite: !note.isFavorite }); }}>
                  {note.isFavorite ? t('取消收藏') : t('收藏')}
                </MenuItem>
                <MenuItem icon={<Copy size={14} />} onClick={() => { close(); void copyNoteLink(); }}>{t('复制链接')}</MenuItem>
                <MenuItem icon={<FileText size={14} />} onClick={() => { close(); void duplicateNote(note.id).then((copy) => { if (copy) navigate(`/app/note/${copy.id}`); }); }}>{t('创建副本')}</MenuItem>
                <MenuItem icon={<FolderIcon />} onClick={() => { close(); setMoveTarget(note.folderId); setShowMove(true); }}>{t('移动到')}</MenuItem>
                <MenuItem icon={<History size={14} />} onClick={() => { close(); setContextTab('history'); }}>{t('版本历史')}</MenuItem>
                {instance?.aiEnabled && (
                  <MenuItem icon={<Sparkles size={14} />} onClick={() => { close(); setShowSummary(true); }}>{t('生成摘要')}</MenuItem>
                )}
                <MenuItem icon={<Mic size={14} />} onClick={() => { close(); startVoice(); }}>{voiceActive ? t('正在聆听…') : t('语音输入')}</MenuItem>
                {!isMobile && (
                  <MenuItem icon={focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />} onClick={() => { close(); setFocusMode(!focusMode); }}>{focusMode ? t('退出聚焦') : t('聚焦模式')}</MenuItem>
                )}
                <div className="menu-separator" />
                <div className="menu-label">{t('导出')}</div>
                <MenuItem icon={<FileText size={14} />} onClick={() => { close(); void exportNote('md'); }}>{t('导出为 Markdown')}</MenuItem>
                <MenuItem icon={<FileCode2 size={14} />} onClick={() => { close(); void exportNote('html'); }}>{t('导出为 HTML')}</MenuItem>
                <MenuItem icon={<Download size={14} />} onClick={() => { close(); void exportNote('pdf'); }}>{t('导出为 PDF')}</MenuItem>
                <div className="menu-separator" />
                <MenuItem icon={<Share2 size={14} />} onClick={() => { close(); setShowShare(true); }}>{t('分享笔记')}</MenuItem>
                <MenuItem icon={<Link2 size={14} />} onClick={() => { close(); setShowWiki(true); }}>{t('双向链接')}</MenuItem>
                <MenuItem icon={<span className="mono" style={{ fontSize: 13 }}>M↓</span>} onClick={() => { close(); void toggleMode(); }}>{mode === 'rich' ? t('Markdown 模式') : t('富文本模式')}</MenuItem>
                <div className="menu-separator" />
                <MenuItem danger icon={<Trash2 size={14} />} onClick={() => { close(); setDeleteOpen(true); }}>{t('删除')}</MenuItem>
              </>
            )}
          </Dropdown>
        </div>
      </header>

      {note.trashedAt && (
        <div style={{ padding: '10px 18px 0' }}>
          <div className="banner banner-warning" style={{ maxWidth: 900, margin: '0 auto' }}>
            <RotateCcw size={15} />
            <div className="banner-body">
              <strong>{t('这篇笔记在回收站中')}</strong> · {t('恢复后才能继续编辑。')}
            </div>
            <div className="banner-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void restoreNote(note.id)}>{t('恢复')}</button>
            </div>
          </div>
        </div>
      )}
      {!note.canEdit && !note.trashedAt && (
        <div style={{ padding: '10px 18px 0' }}>
          <div className="banner banner-info" style={{ maxWidth: 900, margin: '0 auto' }}>
            <Info size={15} />
            <div>{t('你在这个空间中拥有只读权限。')}</div>
          </div>
        </div>
      )}
      {draft && (
        <div style={{ padding: '10px 18px 0' }}>
          <div className="banner banner-warning" style={{ maxWidth: 900, margin: '0 auto' }}>
            <AlertTriangle size={15} />
            <div className="banner-body">
              <strong>{t('发现未保存的草稿')}</strong> · {formatRelativeShort(new Date(draft.updatedAt).toISOString())}
            </div>
            <div className="banner-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={restoreDraft}>{t('恢复草稿')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={discardDraft}>{t('丢弃')}</button>
            </div>
          </div>
        </div>
      )}
      {conflictNoteId && (
        <div style={{ padding: '10px 18px 0' }}>
          <div className="banner banner-warning" style={{ maxWidth: 900, margin: '0 auto' }}>
            <AlertTriangle size={15} />
            <div className="banner-body">{t('检测到冲突，本地内容已保存到版本历史。当前显示的是服务器上的版本。')}</div>
            <div className="banner-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { clearConflict(); setContextTab('history'); }}>
                {t('查看历史版本')}
              </button>
              <button type="button" className="icon-btn icon-btn-sm banner-close" onClick={clearConflict} aria-label={t('关闭提示')}>
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
      {syncState === 'error' && (
        <div style={{ padding: '10px 18px 0' }}>
          <div className="banner banner-error" style={{ maxWidth: 900, margin: '0 auto' }}>
            <AlertTriangle size={15} />
            <div className="banner-body">{t('保存失败')}{syncMessage ? ` · ${syncMessage}` : ''}<div className="setting-note" style={{ marginTop: 2 }}>{t('当前正文和草稿已保存在这台设备，可重试或先复制正文。')}</div></div>
            <div className="banner-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void saveNowRef.current('manual')}>{t('重试')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyText(contentRef.current)}>{t('复制正文')}</button>
            </div>
          </div>
        </div>
      )}
      {syncState === 'offline' && (
        <div style={{ padding: '10px 18px 0' }}>
          <div className="banner" style={{ maxWidth: 900, margin: '0 auto' }}>
            <WifiOff size={15} />
            <div>{t('你正在离线编辑。更改会保存在这台设备上，联网后自动同步。')}</div>
          </div>
        </div>
      )}

      {mode === 'rich' && !readOnly && editor && (
        <EditorToolbar
          editor={editor}
          onLink={openLinkDialog}
          onWiki={() => setShowWiki(true)}
          onImage={(file) => editorHandle?.insertFiles([file])}
        />
      )}

      <div className="editor-scroll app-scroll">
        <div className={cn('editor-page', user?.prefs?.editorWidth === 'wide' && 'wide', user?.prefs?.editorWidth === 'narrow' && 'narrow')}>
          <textarea
            ref={titleRef}
            className="note-title-input"
            value={title}
            onChange={(event) => applyTitle(event.target.value.replace(/\n/g, ' '))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (editor) editor.chain().focus('end').run();
                else document.querySelector<HTMLTextAreaElement>('.markdown-source')?.focus();
              }
            }}
            onBlur={() => {
              if (dirtyRef.current) void saveNowRef.current('auto');
            }}
            placeholder={untitledNoteTitle(note.createdAt)}
            rows={1}
            readOnly={readOnly}
            aria-label={t('标题')}
          />
          <div className="note-submeta">
            <span>{formatFullDate(note.updatedAt)}</span>
            <span className="dot" />
            <span>{t('{n} 字', { n: words })}</span>
            <span className="dot" />
            <span>{t('约 {n} 分钟阅读', { n: readMinutes })}</span>
          </div>

          {mode === 'markdown' ? (
            <div className="animate-fade source-mode">
              <textarea
                className="markdown-source"
                value={content}
                onChange={(event) => applyContent(event.target.value)}
                readOnly={readOnly}
                spellCheck={false}
                autoFocus
              />
            </div>
          ) : (
            <TipTapEditor
              key={`${note.id}-${richSeed}`}
              noteId={note.id}
              initialMarkdown={content}
              reloadKey={0}
              editable={!readOnly}
              spellcheck={user?.prefs?.spellcheck !== false}
              onChange={applyContent}
              onReady={setEditorHandle}
              onWikiOpen={() => setShowWiki(true)}
              uploadFile={uploadAttachment}
            />
          )}
          <EditorTagBar />
        </div>
      </div>

      <div className="editor-footbar">
        <button type="button" className="footbar-button" onClick={() => void toggleMode()}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{mode === 'rich' ? 'M↓' : 'Aa'}</span>
          {mode === 'rich' ? t('Markdown 模式') : t('富文本模式')}
        </button>
        <span className="footbar-spacer" />
        <span className="footbar-item">{t('{n} 字符', { n: chars })}</span>
        <span className="footbar-item">v{note.version}</span>
        <button type="button" className="footbar-button" onClick={() => setFocusMode(!focusMode)} title={focusMode ? t('退出聚焦') : t('聚焦模式')}>
          {focusMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />} {focusMode ? t('退出聚焦') : t('聚焦')}
        </button>
      </div>

      <Modal
        open={showExport}
        onClose={() => setShowExport(false)}
        title={t('导出当前笔记')}
        description={t('导出的文件会保留附件。PDF 由服务器生成。')}
        size="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <button type="button" className="share-permission-option" onClick={() => { setShowExport(false); void exportNote('md'); }}>
            <FileText size={16} /><span><span className="share-permission-name">Markdown</span><span className="share-permission-desc">{t('正文 + 附件，适合长期保存。')}</span></span>
          </button>
          <button type="button" className="share-permission-option" onClick={() => { setShowExport(false); void exportNote('html'); }}>
            <FileCode2 size={16} /><span><span className="share-permission-name">HTML</span><span className="share-permission-desc">{t('独立网页，图片内嵌。')}</span></span>
          </button>
          <button type="button" className="share-permission-option" onClick={() => { setShowExport(false); void exportNote('pdf'); }}>
            <Download size={16} /><span><span className="share-permission-name">PDF</span><span className="share-permission-desc">{t('适合打印与分发。')}</span></span>
          </button>
        </div>
      </Modal>

      <ShareDialog note={note} open={showShare && canShare} onClose={() => setShowShare(false)} />
      <SummaryDialog note={note} open={showSummary} onClose={() => setShowSummary(false)} onInsert={insertSummary} />

      <Modal
        open={showLink}
        onClose={() => setShowLink(false)}
        title={t('插入链接')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowLink(false)}>{t('取消')}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={applyLink} disabled={!linkUrl.trim()}>{t('插入')}</button>
          </>
        }
      >
        <div className="field">
          <label>{t('链接地址')}</label>
          <input className="input" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://" autoFocus onKeyDown={(event) => { if (event.key === 'Enter') applyLink(); }} />
          <span className="field-hint">{t('选中文字后插入，会把文字变成链接。')}</span>
        </div>
      </Modal>

      <Modal
        open={showWiki}
        onClose={() => setShowWiki(false)}
        title={t('链接到另一篇笔记')}
        description={t('插入 [[笔记标题]]，右侧信息面板会显示反向链接。')}
        size="sm"
      >
        <input
          className="input"
          value={wikiQuery}
          onChange={(event) => setWikiQuery(event.target.value)}
          placeholder={t('搜索笔记标题…')}
          autoFocus
          style={{ marginBottom: 10 }}
        />
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {wikiResults.length === 0 ? (
            <div className="context-empty">{t('没有匹配的笔记')}</div>
          ) : (
            wikiResults.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="backlink-item"
                onClick={() => insertWikiLink(entry.title)}
              >
                <div className="backlink-title">{entry.title}</div>
                <div className="backlink-excerpt">{entry.excerpt || t('无标题')}</div>
              </button>
            ))
          )}
        </div>
      </Modal>

      <Modal
        open={showMove}
        onClose={() => setShowMove(false)}
        title={t('移动到文件夹')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowMove(false)}>{t('取消')}</button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => {
                await updateNoteMeta({ folderId: moveTarget });
                setShowMove(false);
                toast('success', t('笔记已移动'));
              }}
            >
              {t('移动')}
            </button>
          </>
        }
      >
        <div style={{ maxHeight: 330, overflowY: 'auto' }}>
          <button
            type="button"
            className={`backlink-item ${moveTarget === null ? 'active' : ''}`}
            onClick={() => setMoveTarget(null)}
            style={moveTarget === null ? { background: 'var(--blue-faint)', borderColor: 'var(--blue)' } : undefined}
          >
            <div className="backlink-title">{t('根目录')}</div>
          </button>
          {sortedFolders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="backlink-item"
              onClick={() => setMoveTarget(folder.id)}
              style={{
                paddingLeft: 10 + folder.depth * 16,
                ...(moveTarget === folder.id ? { background: 'var(--blue-faint)', borderColor: 'var(--blue)' } : {}),
              }}
            >
              <div className="backlink-title">{folder.name}</div>
            </button>
          ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await trashNote(note.id);
          setDeleteOpen(false);
          navigate('/app');
        }}
        title={t('确定要删除这篇笔记吗？')}
        description={t('删除后可在回收站中恢复。')}
        confirmLabel={t('删除')}
        danger
      >
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{note.title}</p>
      </ConfirmDialog>

      {voiceActive && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }} className="animate-rise">
          <div className="banner banner-info" style={{ boxShadow: 'var(--shadow-md)', background: 'var(--surface-raised)' }}>
            <Mic size={15} />
            <div className="banner-body">{t('正在聆听…')}</div>
            <div className="banner-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => voiceRef.current?.stop()}>{t('点击停止')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

function flattenFolders(folders: ReturnType<typeof useAppStore.getState>['folders']): Array<{ id: string; name: string; depth: number }> {
  const output: Array<{ id: string; name: string; depth: number }> = [];
  function walk(parentId: string | null, depth: number) {
    for (const folder of folders.filter((entry) => entry.parentId === parentId)) {
      output.push({ id: folder.id, name: folder.name, depth });
      walk(folder.id, depth + 1);
    }
  }
  walk(null, 0);
  return output;
}

export function EmptyEditorState() {
  const t = useT();
  const navigate = useNavigate();
  const createNote = useAppStore((state) => state.createNote);
  return (
    <div className="editor-empty">
      <div className="editor-empty-mark"><PenLine size={21} /></div>
      <div className="editor-empty-title">{t('从这里开始。')}</div>
      <p className="editor-empty-text">{t('选择左侧的笔记，或写下此刻想到的第一句话。')}</p>
      <div className="editor-empty-actions">
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
        <button type="button" className="btn btn-secondary" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true }))}>
          {t('打开命令面板')} <kbd>{shortcutLabel('Mod+K')}</kbd>
        </button>
      </div>
      <div className="editor-empty-hints">
        <span><Check size={12} /> {t('自动保存')} · {t('离线可写')}</span>
        <span><Clock3 size={12} /> {t('历史版本与冲突副本')}</span>
        <span><FileText size={12} /> {t('Markdown 随时导出')}</span>
      </div>
    </div>
  );
}

// Minimal Web Speech API shapes to avoid depending on lib.dom experimental types.
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
