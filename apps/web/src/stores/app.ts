import { create } from 'zustand';
import type { Folder, Note, NoteSummary, Tag } from '@360note/shared';
import { api, ApiError, isNetworkError } from '../lib/api';
import {
  cacheNote,
  cacheWorkspace,
  clearDraft,
  enqueueOutbox,
  readCachedNote,
  readDraft,
  readOutbox,
  readWorkspaceCache,
  removeCachedNote,
  removeOutbox,
  removeOutboxByNote,
  saveDraft,
  searchCachedNotes,
  updateCachedNote,
  type OutboxItem,
} from '../lib/offline';
import { toast } from './toast';
import { translate } from '../lib/i18n';
import { untitledNoteTitle } from '../lib/utils';
import { mergeText } from '../lib/merge';

export type NoteFilter = 'all' | 'recent' | 'favorites' | 'trash' | 'folder' | 'tag';
export type NoteSort = 'updated' | 'created' | 'title' | 'opened';
export type SyncState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';
export type ContextTab = 'info' | 'backlinks' | 'comments' | 'history';

interface AppState {
  workspaceId: string | null;
  initializedWorkspace: string | null;
  notes: NoteSummary[];
  total: number;
  allTotal: number;
  folders: Folder[];
  tags: Tag[];
  note: Note | null;
  loadingList: boolean;
  loadingNote: boolean;
  listError: string | null;
  filter: NoteFilter;
  folderId: string | null;
  tagId: string | null;
  query: string;
  sort: NoteSort;
  offline: boolean;
  syncState: SyncState;
  syncMessage: string | null;
  pendingCount: number;
  lastSavedAt: number | null;
  sidebarCollapsed: boolean;
  sidebarMobileOpen: boolean;
  contextOpen: boolean;
  contextTab: ContextTab;
  commandOpen: boolean;
  focusMode: boolean;
  reloadTick: number;
  conflictNoteId: string | null;
  freshNoteId: string | null;
  hasMore: boolean;
  serverOffset: number;

  initialize: (workspaceId: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshList: (options?: { append?: boolean; silent?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  refreshFolders: () => Promise<void>;
  refreshTags: () => Promise<void>;
  setFilter: (filter: NoteFilter, opts?: { folderId?: string | null; tagId?: string | null }) => Promise<void>;
  setQuery: (query: string) => void;
  setSort: (sort: NoteSort) => void;
  openNote: (noteId: string, options?: { silent?: boolean }) => Promise<void>;
  reloadNote: () => Promise<void>;
  closeNote: () => void;
  createNote: (input?: { title?: string; contentMd?: string; folderId?: string | null; tagNames?: string[]; tagIds?: string[] }) => Promise<Note | null>;
  saveNote: (input: { noteId: string; title: string; contentMd: string; baseVersion: number; reason?: 'auto' | 'manual' }) => Promise<{ ok: boolean; note?: Note; queued?: boolean; error?: string }>;
  updateNoteMeta: (patch: { title?: string; folderId?: string | null; isFavorite?: boolean; isPinned?: boolean; tagIds?: string[] }) => Promise<void>;
  toggleFavorite: (noteId?: string) => Promise<void>;
  togglePinned: (noteId?: string) => Promise<void>;
  trashNote: (noteId?: string) => Promise<void>;
  restoreNote: (noteId: string) => Promise<void>;
  deletePermanently: (noteId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  batchAction: (action: 'trash' | 'restore' | 'delete' | 'favorite' | 'unfavorite' | 'pin' | 'unpin', ids: string[]) => Promise<void>;
  duplicateNote: (noteId?: string) => Promise<Note | null>;
  restoreVersion: (versionId: number) => Promise<Note | null>;
  flushOutbox: () => Promise<void>;
  setSync: (state: SyncState, message?: string | null) => void;
  setOffline: (offline: boolean) => void;
  toggleSidebar: () => void;
  setMobileSidebar: (open: boolean) => void;
  setContextOpen: (open: boolean) => void;
  setContextTab: (tab: ContextTab) => void;
  setCommandOpen: (open: boolean) => void;
  setFocusMode: (focus: boolean) => void;
  bumpReload: () => void;
  clearConflict: () => void;
  reset: () => void;
}

let flushing = false;
const prefetchedWorkspaces = new Set<string>();

async function prefetchOfflineBundle(workspaceId: string): Promise<void> {
  if (prefetchedWorkspaces.has(workspaceId) || !navigator.onLine) return;
  prefetchedWorkspaces.add(workspaceId);
  try {
    const response = await api.get<{ notes: Note[] }>(`/api/notes/offline-bundle?workspaceId=${workspaceId}&limit=120`);
    for (const note of response.notes) await cacheNote(note);
  } catch {
    prefetchedWorkspaces.delete(workspaceId);
  }
}


async function persistSnapshot(state: AppState): Promise<void> {
  if (!state.workspaceId) return;
  await cacheWorkspace(state.workspaceId, {
    notes: state.notes,
    folders: state.folders,
    tags: state.tags,
    total: state.total,
    allTotal: state.allTotal,
  }).catch(() => {});
}


function localId(): string {
  return `local-${crypto.randomUUID()}`;
}

export function isLocalNote(id: string | null | undefined): boolean {
  return Boolean(id?.startsWith('local-'));
}

function noteSummary(note: Note): NoteSummary {
  const { contentMd, createdBy, updatedBy, folderPath, attachments, wordCount, canEdit, canShare, ...summary } = note;
  void contentMd;
  void createdBy;
  void updatedBy;
  void folderPath;
  void attachments;
  void wordCount;
  void canEdit;
  void canShare;
  return summary;
}

function upsertSummary(notes: NoteSummary[], note: Note): NoteSummary[] {
  const summary = noteSummary(note);
  const index = notes.findIndex((item) => item.id === note.id);
  if (index === -1) return [summary, ...notes];
  const next = [...notes];
  next[index] = { ...next[index], ...summary };
  return next;
}

function removeFromList(notes: NoteSummary[], noteId: string): NoteSummary[] {
  return notes.filter((note) => note.id !== noteId);
}

function matchesFilter(note: NoteSummary, filter: NoteFilter, folderId: string | null, tagId: string | null): boolean {
  if (filter === 'trash') return Boolean(note.trashedAt);
  if (note.trashedAt) return false;
  if (filter === 'favorites') return note.isFavorite;
  if (filter === 'folder') return note.folderId === folderId;
  if (filter === 'tag') return note.tags.some((tag) => tag.id === tagId);
  if (filter === 'recent') return Date.now() - +new Date(note.updatedAt) <= 30 * 86400000;
  return true;
}

function mergeLocalNotes(serverNotes: NoteSummary[], current: NoteSummary[], filter: NoteFilter, folderId: string | null, tagId: string | null, query: string): NoteSummary[] {
  const missing = current.filter(
    (note) =>
      isLocalNote(note.id) &&
      !serverNotes.some((entry) => entry.id === note.id) &&
      matchesFilter(note, filter, folderId, tagId) &&
      (!query || note.title.toLowerCase().includes(query.toLowerCase()) || note.excerpt.toLowerCase().includes(query.toLowerCase())),
  );
  return [...missing, ...serverNotes];
}

const initialCollapsed = localStorage.getItem('nh-sidebar-collapsed') === 'true';

export const useAppStore = create<AppState>((set, get) => ({
  workspaceId: null,
  initializedWorkspace: null,
  notes: [],
  total: 0,
  allTotal: 0,
  folders: [],
  tags: [],
  note: null,
  loadingList: false,
  loadingNote: false,
  listError: null,
  filter: 'all',
  folderId: null,
  tagId: null,
  query: '',
  sort: 'updated',
  offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  syncState: 'idle',
  syncMessage: null,
  pendingCount: 0,
  lastSavedAt: null,
  sidebarCollapsed: initialCollapsed,
  sidebarMobileOpen: false,
  contextOpen: false,
  contextTab: 'info',
  commandOpen: false,
  focusMode: false,
  reloadTick: 0,
  conflictNoteId: null,
  freshNoteId: null,
  hasMore: false,
  serverOffset: 0,

  initialize: async (workspaceId) => {
    const state = get();
    if (state.workspaceId !== workspaceId) {
      set({
        workspaceId,
        note: null,
        notes: [],
        folders: [],
        tags: [],
        filter: 'all',
        folderId: null,
        tagId: null,
        query: '',
        sort: 'updated',
        syncState: 'idle',
        syncMessage: null,
      });
      localStorage.setItem('nh-workspace', workspaceId);
    }
    set({ loadingList: true, listError: null });
    const cached = await readWorkspaceCache(workspaceId);
    if (cached) {
      set({
        notes: cached.notes,
        folders: cached.folders,
        tags: cached.tags,
        total: cached.total,
        allTotal: cached.allTotal ?? cached.total,
        loadingList: false,
      });
    }
    const outbox = await readOutbox();
    set({ pendingCount: outbox.length });
    try {
      const [foldersResponse, tagsResponse, notesResponse] = await Promise.all([
        api.get<{ folders: Folder[] }>(`/api/folders?workspaceId=${workspaceId}`),
        api.get<{ tags: Tag[] }>(`/api/tags?workspaceId=${workspaceId}`),
        api.get<{ notes: NoteSummary[]; total: number; allTotal: number }>(`/api/notes?workspaceId=${workspaceId}&filter=all&sort=updated&limit=100`),
      ]);
      const notes = mergeLocalNotes(notesResponse.notes, get().notes, 'all', null, null, '');
      set({
        folders: foldersResponse.folders,
        tags: tagsResponse.tags,
        notes,
        total: notesResponse.total + (notes.length - notesResponse.notes.length),
        allTotal: (notesResponse.allTotal ?? notesResponse.total) + (notes.length - notesResponse.notes.length),
        loadingList: false,
        initializedWorkspace: workspaceId,
        offline: false,
        serverOffset: notesResponse.notes.length,
        hasMore: notesResponse.notes.length < notesResponse.total,
        syncState: outbox.length ? 'offline' : get().syncState === 'idle' ? 'saved' : get().syncState,
      });
      await cacheWorkspace(workspaceId, {
        notes,
        folders: foldersResponse.folders,
        tags: tagsResponse.tags,
        total: notesResponse.total,
      });
      if (outbox.length) void get().flushOutbox();
      window.setTimeout(() => void prefetchOfflineBundle(workspaceId), 2500);
    } catch (error) {
      const network = !navigator.onLine || isNetworkError(error);
      set({
        loadingList: false,
        offline: network,
        syncState: network ? 'offline' : 'error',
        syncMessage: network ? translate('离线') : null,
        listError: cached ? null : (error as Error).message,
        initializedWorkspace: workspaceId,
      });
    }
  },

  refreshAll: async () => {
    await Promise.all([get().refreshFolders(), get().refreshTags(), get().refreshList()]);
  },

  refreshList: async (options) => {
    const { workspaceId, filter, folderId, tagId, query, sort, notes } = get();
    if (!workspaceId) return;
    if (!options?.silent) set({ loadingList: !options?.append });
    try {
      let response: { notes: NoteSummary[]; total: number; allTotal: number };
      if (query.trim()) {
        response = await api.get<{ notes: NoteSummary[]; total: number; allTotal: number }>(
          `/api/search?workspaceId=${workspaceId}&q=${encodeURIComponent(query.trim())}&limit=100`,
        );
      } else {
        const params = new URLSearchParams({
          workspaceId,
          filter,
          sort,
          limit: '100',
        });
        if (filter === 'folder' && folderId) params.set('folderId', folderId);
        if (filter === 'tag' && tagId) params.set('tagId', tagId);
        response = await api.get<{ notes: NoteSummary[]; total: number; allTotal: number }>(`/api/notes?${params.toString()}`);
      }
      let serverNotes = response.notes;
      if (options?.append) {
        const existing = new Set(notes.map((note) => note.id));
        serverNotes = [...notes, ...serverNotes.filter((note) => !existing.has(note.id))];
      }
      const merged = mergeLocalNotes(serverNotes, get().notes, filter, folderId, tagId, query);
      const offset = options?.append ? get().serverOffset + response.notes.length : response.notes.length;
      set({
        notes: merged,
        total: response.total + (merged.length - response.notes.length),
        allTotal: (response.allTotal ?? response.total) + (filter === 'all' && !query.trim() ? Math.max(0, merged.length - response.notes.length) : 0),
        loadingList: false,
        offline: false,
        serverOffset: offset,
        hasMore: offset < response.total,
      });
      await cacheWorkspace(workspaceId, {
        notes: merged,
        folders: get().folders,
        tags: get().tags,
        total: response.total,
        allTotal: get().allTotal,
      });
    } catch (error) {
      if (isNetworkError(error) || !navigator.onLine) {
        let offlineResults: NoteSummary[];
        if (query.trim()) {
          offlineResults = await searchCachedNotes(query, 100);
        } else {
          const cached = await readWorkspaceCache(workspaceId);
          offlineResults = (cached?.notes ?? get().notes).filter((note) => matchesFilter(note, filter, folderId, tagId));
        }
        const merged = mergeLocalNotes(offlineResults, get().notes, filter, folderId, tagId, query);
        set({
          notes: merged,
          loadingList: false,
          offline: true,
          syncState: 'offline',
          syncMessage: translate('离线'),
          hasMore: false,
          serverOffset: merged.length,
        });
      } else {
        set({ loadingList: false, listError: (error as Error).message });
      }
    }
  },

  loadMore: async () => {
    const { workspaceId, filter, folderId, tagId, query, sort, serverOffset, hasMore, loadingList } = get();
    if (!workspaceId || !hasMore || loadingList) return;
    set({ loadingList: true });
    try {
      let response: { notes: NoteSummary[]; total: number; allTotal: number };
      if (query.trim()) {
        response = await api.get<{ notes: NoteSummary[]; total: number; allTotal: number }>(
          `/api/search?workspaceId=${workspaceId}&q=${encodeURIComponent(query.trim())}&limit=60&offset=${serverOffset}`,
        );
      } else {
        const params = new URLSearchParams({ workspaceId, filter, sort, limit: '100', offset: String(serverOffset) });
        if (filter === 'folder' && folderId) params.set('folderId', folderId);
        if (filter === 'tag' && tagId) params.set('tagId', tagId);
        response = await api.get<{ notes: NoteSummary[]; total: number; allTotal: number }>(`/api/notes?${params.toString()}`);
      }
      const existing = new Set(get().notes.map((note) => note.id));
      const appended = response.notes.filter((note) => !existing.has(note.id));
      const notes = [...get().notes, ...appended];
      const offset = serverOffset + response.notes.length;
      set({
        notes,
        total: response.total + Math.max(0, notes.length - response.notes.length),
        allTotal: response.allTotal ?? get().allTotal,
        loadingList: false,
        serverOffset: offset,
        hasMore: offset < response.total,
      });
      await cacheWorkspace(get().workspaceId!, {
        notes,
        folders: get().folders,
        tags: get().tags,
        total: response.total,
        allTotal: get().allTotal,
      });
    } catch (error) {
      set({ loadingList: false, listError: (error as Error).message });
    }
  },

  refreshFolders: async () => {
    const { workspaceId } = get();
    if (!workspaceId) return;
    try {
      const response = await api.get<{ folders: Folder[] }>(`/api/folders?workspaceId=${workspaceId}`);
      set({ folders: response.folders });
    } catch {
      /* keep cached */
    }
  },

  refreshTags: async () => {
    const { workspaceId } = get();
    if (!workspaceId) return;
    try {
      const response = await api.get<{ tags: Tag[] }>(`/api/tags?workspaceId=${workspaceId}`);
      set({ tags: response.tags });
    } catch {
      /* keep cached */
    }
  },

  setFilter: async (filter, opts) => {
    set({
      filter,
      folderId: opts?.folderId !== undefined ? opts.folderId : filter === 'folder' ? get().folderId : null,
      tagId: opts?.tagId !== undefined ? opts.tagId : filter === 'tag' ? get().tagId : null,
      query: '',
      sidebarMobileOpen: false,
      notes: [],
      total: 0,
      loadingList: true,
      listError: null,
    });
    set({ note: get().note, commandOpen: false });
    await get().refreshList();
  },

  setQuery: (query) => {
    set({ query });
  },

  setSort: (sort) => {
    set({ sort });
    void get().refreshList();
  },

  openNote: async (noteId, options) => {
    set({ loadingNote: !options?.silent, sidebarMobileOpen: false });
    const cached = await readCachedNote(noteId);
    if (cached) {
      set({ note: cached.note, loadingNote: false });
    }
    if (isLocalNote(noteId)) {
      if (!cached) {
        set({ loadingNote: false });
        toast('error', translate('无法加载笔记'), translate('它可能已被删除，或你没有访问权限。'));
      }
      return;
    }
    const shown = get().note;
    try {
      const response = await api.get<{ note: Note }>(`/api/notes/${noteId}`);
      const changed =
        Boolean(shown && shown.id === response.note.id) &&
        (shown!.version !== response.note.version ||
          shown!.title !== response.note.title ||
          shown!.contentMd !== response.note.contentMd);
      set({
        note: response.note,
        loadingNote: false,
        conflictNoteId: null,
        ...(changed ? { reloadTick: get().reloadTick + 1 } : {}),
      });
      await cacheNote(response.note);
      set({ notes: upsertSummary(get().notes, response.note) });
      void api.post(`/api/notes/${noteId}/open`).catch(() => {});
      const draft = await readDraft(noteId);
      if (draft && draft.updatedAt > new Date(response.note.updatedAt).getTime()) {
        window.dispatchEvent(new CustomEvent('nh:draft-available', { detail: draft }));
      }
    } catch (error) {
      if (isNetworkError(error) || !navigator.onLine) {
        if (cached) {
          set({ note: cached.note, loadingNote: false, offline: true, syncState: 'offline' });
        } else {
          set({ loadingNote: false, note: null });
          toast('error', translate('无法加载笔记'), translate('你正在离线，且这篇笔记没有本地缓存。'));
        }
      } else {
        set({ loadingNote: false, note: null });
        toast('error', translate('找不到这篇笔记'), (error as Error).message);
      }
    }
  },

  reloadNote: async () => {
    const current = get().note;
    if (!current || isLocalNote(current.id)) return;
    try {
      const response = await api.get<{ note: Note }>(`/api/notes/${current.id}`);
      set({
        note: get().note?.id === response.note.id ? { ...response.note, contentMd: get().note?.contentMd ?? response.note.contentMd } : get().note,
        notes: upsertSummary(get().notes, response.note),
      });
      // Do not overwrite the cached baseContent while an editor may have
      // unsaved changes; the base must remain the last acknowledged revision.
      if (!get().note || get().note?.id !== response.note.id) await cacheNote(response.note);
    } catch {
      /* keep current */
    }
  },

  closeNote: () => set({ note: null, contextOpen: false }),

  createNote: async (input) => {
    const { workspaceId, folders, tags } = get();
    if (!workspaceId) return null;
    const title = input?.title?.trim() || untitledNoteTitle();
    const contentMd = input?.contentMd ?? '';
    const folderId = input?.folderId ?? null;
    try {
      const response = await api.post<{ note: Note }>('/api/notes', {
        workspaceId,
        title,
        contentMd,
        folderId,
        tagIds: input?.tagIds,
        tagNames: input?.tagNames,
      });
      const note = response.note;
      set({
        note,
        notes: upsertSummary(get().notes, note),
        allTotal: get().allTotal + 1,
        query: '',
        syncState: 'saved',
        lastSavedAt: Date.now(),
        conflictNoteId: null,
        freshNoteId: note.id,
      });
      await cacheNote(note);
      await persistSnapshot(get());
      if (input?.tagNames?.length) void get().refreshTags();
      void folders;
      void tags;
      return note;
    } catch (error) {
      if (!isNetworkError(error) && navigator.onLine) {
        toast('error', translate('保存失败'), (error as Error).message);
        return null;
      }
      const now = new Date().toISOString();
      const selectedTags = (input?.tagIds ?? []).map((id) => {
        const tag = get().tags.find((entry) => entry.id === id);
        return { id, name: tag?.name ?? '', color: tag?.color ?? null };
      }).filter((tag) => tag.name);
      const note: Note = {
        id: localId(),
        workspaceId,
        folderId,
        title,
        excerpt: contentMd.replace(/[#*_>`[\]()]/g, '').slice(0, 160),
        version: 0,
        isFavorite: false,
        isPinned: false,
        encrypted: false,
        createdAt: now,
        updatedAt: now,
        trashedAt: null,
        tags: selectedTags.length ? selectedTags : (input?.tagNames ?? []).map((name) => ({ id: `local-tag-${name}`, name, color: null })),
        attachmentCount: 0,
        contentMd,
        createdBy: '',
        updatedBy: '',
        folderPath: [],
        attachments: [],
        wordCount: 0,
        canEdit: true,
        canShare: false,
      };
      set({
        note,
        notes: [noteSummary(note), ...get().notes],
        allTotal: get().allTotal + 1,
        filter: 'all',
        folderId: null,
        tagId: null,
        query: '',
        offline: true,
        syncState: 'offline',
        syncMessage: translate('离线编辑'),
        pendingCount: get().pendingCount + 1,
        freshNoteId: note.id,
      });
      await updateCachedNote(note);
      await saveDraft({
        noteId: note.id,
        workspaceId,
        title,
        contentMd,
        baseVersion: 0,
        updatedAt: Date.now(),
      });
      await enqueueOutbox({
        id: crypto.randomUUID(),
        kind: 'create',
        noteId: note.id,
        workspaceId,
        title,
        contentMd,
        baseVersion: 0,
        folderId,
        tagIds: input?.tagIds,
        tagNames: input?.tagNames,
        updatedAt: Date.now(),
        createdAt: Date.now(),
        attempts: 0,
      } as OutboxItem);
      await persistSnapshot(get());
      return note;
    }
  },

  saveNote: async ({ noteId, title, contentMd, baseVersion, reason = 'auto' }) => {
    const current = get().note;
    if (!current || current.id !== noteId) return { ok: false, error: 'note-changed' };
    const { workspaceId } = current;
    if (isLocalNote(current.id)) {
      const local: Note = { ...current, title, contentMd, excerpt: contentMd.slice(0, 160), updatedAt: new Date().toISOString() };
      set({ note: local, notes: upsertSummary(get().notes, local), syncState: 'offline', syncMessage: translate('离线编辑') });
      await updateCachedNote(local);
      await saveDraft({ noteId: local.id, workspaceId, title, contentMd, baseVersion, updatedAt: Date.now() });
      await enqueueOutbox({
        id: crypto.randomUUID(),
        kind: 'create',
        noteId: local.id,
        workspaceId,
        title,
        contentMd,
        baseVersion: 0,
        folderId: local.folderId,
        tagIds: local.tags.map((tag) => tag.id).filter((id) => !id.startsWith('local-')),
        tagNames: local.tags.map((tag) => tag.name),
        updatedAt: Date.now(),
        createdAt: Date.now(),
        attempts: 0,
      } as OutboxItem);
      set({ pendingCount: (await readOutbox()).length });
      await persistSnapshot(get());
      return { ok: false, queued: true };
    }
    set({ syncState: 'saving', syncMessage: null });
    await saveDraft({ noteId: current.id, workspaceId, title, contentMd, baseVersion, updatedAt: Date.now() });
    try {
      const response = await api.patch<{ note: Note }>(`/api/notes/${current.id}`, {
        title,
        contentMd,
        baseVersion,
        reason,
      });
      const note = response.note;
      set({
        note: get().note?.id === note.id ? note : get().note,
        notes: upsertSummary(get().notes, note),
        syncState: 'saved',
        syncMessage: null,
        lastSavedAt: Date.now(),
        conflictNoteId: null,
      });
      await cacheNote(note);
      await removeOutboxByNote(note.id);
      set({ pendingCount: (await readOutbox()).length });
      await persistSnapshot(get());
      return { ok: true, note };
    } catch (error) {
      if (isNetworkError(error) || !navigator.onLine) {
        const local: Note = { ...current, title, contentMd, updatedAt: new Date().toISOString() };
        set({ note: local, notes: upsertSummary(get().notes, local), offline: true, syncState: 'offline', syncMessage: translate('离线编辑') });
        await updateCachedNote(local);
        await enqueueOutbox({
          id: crypto.randomUUID(),
          kind: 'update',
          noteId: current.id,
          workspaceId,
          title,
          contentMd,
          baseVersion,
          folderId: current.folderId,
          tagIds: current.tags.map((tag) => tag.id).filter((id) => !id.startsWith('local-')),
          tagNames: current.tags.map((tag) => tag.name),
          updatedAt: Date.now(),
          createdAt: Date.now(),
          attempts: 0,
        } as OutboxItem);
        set({ pendingCount: (await readOutbox()).length });
        await persistSnapshot(get());
        return { ok: false, queued: true };
      }
      if (error instanceof ApiError && error.status === 409) {
        const conflict = (error.details as { current?: Note } | undefined)?.current;
        if (conflict) {
          const result = await resolveConflict(get, set, current.id, title, contentMd, conflict);
          if (result) return { ok: true, note: result };
        }
      }
      set({ syncState: 'error', syncMessage: (error as Error).message });
      return { ok: false, error: (error as Error).message };
    }
  },

  updateNoteMeta: async (patch) => {
    const current = get().note;
    if (!current) return;
    if (isLocalNote(current.id)) {
      const local: Note = {
        ...current,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
        ...(patch.isFavorite !== undefined ? { isFavorite: patch.isFavorite } : {}),
        ...(patch.isPinned !== undefined ? { isPinned: patch.isPinned } : {}),
        ...(patch.tagIds ? { tags: get().tags.filter((tag) => patch.tagIds!.includes(tag.id)) } : {}),
        updatedAt: new Date().toISOString(),
      };
      set({ note: local, notes: upsertSummary(get().notes, local) });
      await updateCachedNote(local);
      await removeOutboxByNote(local.id);
      await enqueueOutbox({
        id: crypto.randomUUID(),
        kind: 'create',
        noteId: local.id,
        workspaceId: local.workspaceId,
        title: local.title,
        contentMd: local.contentMd,
        baseVersion: 0,
        folderId: local.folderId,
        tagIds: local.tags.map((tag) => tag.id).filter((id) => !id.startsWith('local-')),
        tagNames: local.tags.map((tag) => tag.name),
        updatedAt: Date.now(),
        createdAt: Date.now(),
        attempts: 0,
      } as OutboxItem);
      set({ pendingCount: (await readOutbox()).length });
      await persistSnapshot(get());
      return;
    }
    const optimistic = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
      ...(patch.isFavorite !== undefined ? { isFavorite: patch.isFavorite } : {}),
      ...(patch.isPinned !== undefined ? { isPinned: patch.isPinned } : {}),
      ...(patch.tagIds ? { tags: get().tags.filter((tag) => patch.tagIds!.includes(tag.id)) } : {}),
    };
    set({ note: optimistic, notes: upsertSummary(get().notes, optimistic) });
    try {
      const response = await api.patch<{ note: Note }>(`/api/notes/${current.id}`, patch);
      set({ note: response.note, notes: upsertSummary(get().notes, response.note) });
      await cacheNote(response.note);
      await persistSnapshot(get());
      void get().refreshList({ silent: true });
      void get().refreshFolders();
      void get().refreshTags();
    } catch (error) {
      toast('error', translate('保存失败'), (error as Error).message);
      void get().openNote(current.id, { silent: true });
    }
  },

  toggleFavorite: async (noteId) => {
    const target = noteId ? get().notes.find((note) => note.id === noteId) : get().note;
    if (!target) return;
    const nextFavorite = !target.isFavorite;
    if (get().note?.id === target.id) {
      await get().updateNoteMeta({ isFavorite: nextFavorite });
    } else {
      await api.patch(`/api/notes/${target.id}`, { isFavorite: nextFavorite });
      set({ notes: get().notes.map((note) => (note.id === target.id ? { ...note, isFavorite: nextFavorite } : note)) });
    }
    if (!nextFavorite && get().filter === 'favorites') {
      set({ notes: get().notes.filter((note) => note.id !== target.id), total: Math.max(0, get().total - 1) });
    }
  },

  togglePinned: async (noteId) => {
    const target = noteId ? get().notes.find((note) => note.id === noteId) : get().note;
    if (!target) return;
    if (get().note?.id === target.id) {
      await get().updateNoteMeta({ isPinned: !target.isPinned });
    } else {
      await api.patch(`/api/notes/${target.id}`, { isPinned: !target.isPinned });
      set({ notes: get().notes.map((note) => (note.id === target.id ? { ...note, isPinned: !note.isPinned } : note)) });
    }
  },

  trashNote: async (noteId) => {
    const id = noteId ?? get().note?.id;
    if (!id) return;
    if (isLocalNote(id)) {
      set({ notes: removeFromList(get().notes, id), note: null });
      await removeCachedNote(id);
      await removeOutboxByNote(id);
      await clearDraft(id);
      set({ pendingCount: (await readOutbox()).length });
      return;
    }
    await api.delete(`/api/notes/${id}`);
    set({
      notes: removeFromList(get().notes, id),
      note: get().note?.id === id ? null : get().note,
      total: Math.max(0, get().total - 1),
    });
    await persistSnapshot(get());
    toast('success', translate('笔记已移到回收站'));
  },

  restoreNote: async (noteId) => {
    await api.post(`/api/notes/${noteId}/restore`);
    toast('success', translate('笔记已恢复'));
    await get().refreshAll();
    await get().openNote(noteId);
  },

  deletePermanently: async (noteId) => {
    if (isLocalNote(noteId)) {
      set({ notes: removeFromList(get().notes, noteId), note: null });
      return;
    }
    await api.delete(`/api/notes/${noteId}/permanent`);
    set({ notes: removeFromList(get().notes, noteId), note: null });
    await removeCachedNote(noteId);
    await persistSnapshot(get());
    toast('success', translate('彻底删除'));
  },

  emptyTrash: async () => {
    const { workspaceId } = get();
    if (!workspaceId) return;
    await api.post('/api/notes/empty-trash', { workspaceId });
    set({ notes: [], total: 0, allTotal: 0 });
    await persistSnapshot(get());
    await get().refreshAll();
  },

  batchAction: async (action, ids) => {
    await api.post('/api/notes/batch', { action, ids });
    await get().refreshAll();
    if (get().note && ids.includes(get().note!.id) && (action === 'trash' || action === 'delete')) {
      set({ note: null });
    }
    await persistSnapshot(get());
    toast('success', translate('操作完成'));
  },

  duplicateNote: async (noteId) => {
    const id = noteId ?? get().note?.id;
    if (!id) return null;
    const response = await api.post<{ note: Note }>(`/api/notes/${id}/duplicate`);
    const note = response.note;
    set({ note, notes: [noteSummary(note), ...get().notes] });
    await cacheNote(note);
    toast('success', translate('笔记已复制'));
    return note;
  },

  restoreVersion: async (versionId) => {
    const current = get().note;
    if (!current) return null;
    const response = await api.post<{ note: Note }>(`/api/notes/${current.id}/versions/${versionId}/restore`);
    const note = response.note;
    set({
      note,
      notes: upsertSummary(get().notes, note),
      reloadTick: get().reloadTick + 1,
      syncState: 'saved',
      lastSavedAt: Date.now(),
    });
    await cacheNote(note);
    toast('success', translate('版本已恢复'));
    return note;
  },

  flushOutbox: async () => {
    if (flushing || !navigator.onLine) return;
    flushing = true;
    try {
      const items = await readOutbox();
      if (!items.length) {
        set({ pendingCount: 0 });
        return;
      }
      set({ syncState: 'saving', syncMessage: translate('同步中') });
      for (const item of items) {
        try {
          if (item.kind === 'create' || isLocalNote(item.noteId)) {
            const response = await api.post<{ note: Note }>('/api/notes', {
              workspaceId: item.workspaceId,
              title: item.title,
              contentMd: item.contentMd,
              folderId: item.folderId ?? null,
              tagIds: item.tagIds,
              tagNames: item.tagNames,
            });
            const note = response.note;
            const localNoteId = item.noteId;
            set({
              notes: [noteSummary(note), ...get().notes.filter((entry) => entry.id !== localNoteId && entry.id !== note.id)],
              note: get().note?.id === localNoteId ? note : get().note,
              syncState: 'saved',
              lastSavedAt: Date.now(),
            });
            window.dispatchEvent(new CustomEvent('nh:local-note-synced', { detail: { localId: localNoteId, newId: note.id } }));
            await cacheNote(note);
            await removeCachedNote(localNoteId);
            await removeOutbox(item.id);
            const pendingDraft = await readDraft(localNoteId);
            if (!pendingDraft || pendingDraft.contentMd === item.contentMd) await clearDraft(localNoteId);
            continue;
          }
          const response = await api.patch<{ note: Note }>(`/api/notes/${item.noteId}`, {
            title: item.title,
            contentMd: item.contentMd,
            baseVersion: item.baseVersion,
            reason: 'auto',
          });
          const note = response.note;
          set({
            notes: upsertSummary(get().notes, note),
            note: get().note?.id === note.id ? note : get().note,
            syncState: 'saved',
            lastSavedAt: Date.now(),
          });
          await cacheNote(note);
          await removeOutbox(item.id);
          const pendingDraft = await readDraft(note.id);
          if (!pendingDraft || pendingDraft.contentMd === item.contentMd) await clearDraft(note.id);
        } catch (error) {
          if (isNetworkError(error) || !navigator.onLine) {
            set({ offline: true, syncState: 'offline', syncMessage: translate('离线编辑') });
            break;
          }
          if (error instanceof ApiError && error.status === 409) {
            const remote = (error.details as { current?: Note } | undefined)?.current;
            if (remote && (item.kind !== 'create')) {
              const resolved = await resolveConflict(get, set, item.noteId, item.title, item.contentMd, remote);
              if (!resolved) break;
              await removeOutbox(item.id);
              continue;
            }
          }
          set({ syncState: 'error', syncMessage: (error as Error).message });
          break;
        }
      }
      const remaining = await readOutbox();
      if (!remaining.length) {
        set({
          pendingCount: 0,
          offline: false,
          syncState: 'saved',
          syncMessage: null,
        });
        await persistSnapshot(get());
        void get().refreshAll();
      } else {
        set({
          pendingCount: remaining.length,
          syncState: 'offline',
          syncMessage: translate('待同步', { n: remaining.length }),
        });
      }
    } finally {
      flushing = false;
    }
  },

  reset: () => set({
    workspaceId: null,
    initializedWorkspace: null,
    notes: [],
    total: 0,
    folders: [],
    tags: [],
    note: null,
    loadingList: false,
    loadingNote: false,
    listError: null,
    filter: 'all',
    folderId: null,
    tagId: null,
    query: '',
    sort: 'updated',
    offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    syncState: 'idle',
    syncMessage: null,
    pendingCount: 0,
    lastSavedAt: null,
    sidebarMobileOpen: false,
    contextOpen: false,
    contextTab: 'info',
    commandOpen: false,
    focusMode: false,
    reloadTick: get().reloadTick + 1,
    conflictNoteId: null,
    freshNoteId: null,
    hasMore: false,
    serverOffset: 0,
  }),
  setSync: (syncState, syncMessage = null) => set({ syncState, syncMessage }),
  setOffline: (offline) => set({ offline, syncState: offline ? 'offline' : get().syncState, syncMessage: offline ? translate('离线') : null }),
  toggleSidebar: () => {
    const collapsed = !get().sidebarCollapsed;
    localStorage.setItem('nh-sidebar-collapsed', String(collapsed));
    set({ sidebarCollapsed: collapsed });
  },
  setMobileSidebar: (open) => set({ sidebarMobileOpen: open }),
  setContextOpen: (open) => set({ contextOpen: open }),
  setContextTab: (tab) => set({ contextTab: tab, contextOpen: true }),
  setCommandOpen: (open) => set({ commandOpen: open }),
  setFocusMode: (focus) => set({ focusMode: focus }),
  bumpReload: () => set({ reloadTick: get().reloadTick + 1 }),
  clearConflict: () => set({ conflictNoteId: null }),
}));

async function resolveConflict(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  noteId: string,
  localTitle: string,
  localContent: string,
  remote: Note,
): Promise<Note | null> {
  const cached = await readCachedNote(noteId);
  const base = cached?.baseContent ?? '';
  const merged = base ? mergeText(localContent, base, remote.contentMd) : null;
  if (merged !== null && merged !== remote.contentMd) {
    try {
      const response = await api.patch<{ note: Note }>(`/api/notes/${noteId}`, {
        title: localTitle,
        contentMd: merged,
        baseVersion: remote.version,
      });
      const note = response.note;
      set({
        note: get().note?.id === note.id ? note : get().note,
        notes: upsertSummary(get().notes, note),
        syncState: 'saved',
        lastSavedAt: Date.now(),
        reloadTick: get().reloadTick + 1,
      });
      await cacheNote(note);
      return note;
    } catch {
      /* fall through to conflict copy */
    }
  }
  try {
    await api.post<{ version: number }>(`/api/notes/${noteId}/conflicts`, {
      title: localTitle,
      contentMd: localContent,
    });
    set({
      note: get().note?.id === noteId ? remote : get().note,
      notes: upsertSummary(get().notes, remote),
      conflictNoteId: noteId,
      contextTab: 'history',
      syncState: 'saved',
      reloadTick: get().reloadTick + 1,
    });
    await cacheNote(remote);
    return remote;
  } catch (error) {
    toast('error', translate('冲突内容保存失败'), (error as Error).message);
    return null;
  }
}
