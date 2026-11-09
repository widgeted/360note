import { clear, del, get, set } from 'idb-keyval';
import type { Folder, Note, NoteSummary, Tag } from '@360note/shared';

const PREFIX = 'nh:v1:';

// Once local data is being cleared on logout/account switch, in-flight autosaves
// must not repopulate IndexedDB before the next account logs in.
let localWritesEnabled = true;

export function setLocalWritesEnabled(enabled: boolean): void {
  localWritesEnabled = enabled;
}


export interface WorkspaceSnapshot {
  notes: NoteSummary[];
  folders: Folder[];
  tags: Tag[];
  total: number;
  cachedAt: number;
}

export interface CachedNote {
  note: Note;
  baseContent: string;
  cachedAt: number;
}

export interface Draft {
  noteId: string;
  workspaceId: string;
  title: string;
  contentMd: string;
  baseVersion: number;
  updatedAt: number;
}

export interface OutboxItem extends Draft {
  id: string;
  kind?: 'update' | 'create';
  folderId?: string | null;
  tagIds?: string[];
  tagNames?: string[];
  attempts: number;
  createdAt: number;
}

let outboxLock: Promise<unknown> = Promise.resolve();
function withOutboxLock<T>(task: () => Promise<T>): Promise<T> {
  const next = outboxLock.then(task, task);
  outboxLock = next.catch(() => {});
  return next;
}

export async function cacheWorkspace(workspaceId: string, snapshot: Omit<WorkspaceSnapshot, 'cachedAt'>): Promise<void> {
  if (!localWritesEnabled) return;
  try {
    await set(`${PREFIX}workspace:${workspaceId}`, { ...snapshot, cachedAt: Date.now() } satisfies WorkspaceSnapshot);
  } catch {
    /* storage may be unavailable in private mode */
  }
}

export async function readWorkspaceCache(workspaceId: string): Promise<WorkspaceSnapshot | null> {
  try {
    return (await get<WorkspaceSnapshot>(`${PREFIX}workspace:${workspaceId}`)) ?? null;
  } catch {
    return null;
  }
}

export async function cacheNote(note: Note): Promise<void> {
  if (!localWritesEnabled) return;
  try {
    await set(`${PREFIX}note:${note.id}`, {
      note,
      baseContent: note.contentMd,
      cachedAt: Date.now(),
    } satisfies CachedNote);
  } catch {
    /* ignore */
  }
}

export async function readCachedNote(noteId: string): Promise<CachedNote | null> {
  try {
    return (await get<CachedNote>(`${PREFIX}note:${noteId}`)) ?? null;
  } catch {
    return null;
  }
}

export async function removeCachedNote(noteId: string): Promise<void> {
  try {
    await del(`${PREFIX}note:${noteId}`);
  } catch {
    /* ignore */
  }
}

export async function saveDraft(draft: Draft): Promise<void> {
  if (!localWritesEnabled) return;
  try {
    await set(`${PREFIX}draft:${draft.noteId}`, draft);
  } catch {
    /* ignore */
  }
}

export async function readDraft(noteId: string): Promise<Draft | null> {
  try {
    return (await get<Draft>(`${PREFIX}draft:${noteId}`)) ?? null;
  } catch {
    return null;
  }
}

export async function clearDraft(noteId: string): Promise<void> {
  try {
    await del(`${PREFIX}draft:${noteId}`);
  } catch {
    /* ignore */
  }
}

export async function readOutbox(): Promise<OutboxItem[]> {
  try {
    return (await get<OutboxItem[]>(`${PREFIX}outbox`)) ?? [];
  } catch {
    return [];
  }
}

export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  if (!localWritesEnabled) return;
  await withOutboxLock(async () => {
    const items = await readOutbox();
    const existingIndex = items.findIndex((entry) => entry.noteId === item.noteId);
    if (existingIndex >= 0) {
      // Keep the earliest baseVersion, but the newest text.
      items[existingIndex] = {
        ...item,
        baseVersion: Math.min(items[existingIndex].baseVersion, item.baseVersion),
        createdAt: items[existingIndex].createdAt,
      };
    } else {
      items.push(item);
    }
    await set(`${PREFIX}outbox`, items);
  });
}

export async function removeOutbox(id: string): Promise<void> {
  await withOutboxLock(async () => {
    const items = await readOutbox();
    await set(`${PREFIX}outbox`, items.filter((entry) => entry.id !== id));
  });
}

export async function removeOutboxByNote(noteId: string): Promise<void> {
  await withOutboxLock(async () => {
    const items = await readOutbox();
    await set(`${PREFIX}outbox`, items.filter((entry) => entry.noteId !== noteId));
  });
}

export async function clearOutbox(): Promise<void> {
  await withOutboxLock(async () => {
    await set(`${PREFIX}outbox`, []);
  });
}

export async function searchCachedNotes(query: string, limit = 30): Promise<NoteSummary[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const snapshot = await readWorkspaceCache(localStorage.getItem('nh-workspace') ?? '');
  if (!snapshot) return [];
  const matches: NoteSummary[] = [];
  for (const note of snapshot.notes) {
    let score = 0;
    if (note.title.toLowerCase().includes(needle)) score += 10;
    if (note.excerpt.toLowerCase().includes(needle)) score += 4;
    if (note.tags.some((tag) => tag.name.toLowerCase().includes(needle))) score += 6;
    if (!score) {
      const cached = await readCachedNote(note.id);
      if (cached?.note.contentMd.toLowerCase().includes(needle)) score += 2;
    }
    if (score > 0) matches.push({ ...note, snippet: note.excerpt });
  }
  return matches.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, limit);
}

export async function cacheSize(): Promise<number> {
  if (!navigator.storage?.estimate) return 0;
  const estimate = await navigator.storage.estimate();
  return estimate.usage ?? 0;
}

/**
 * Ask the browser not to evict offline note bodies/drafts under storage
 * pressure. Browsers may grant this silently based on engagement.
 */
export async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* unsupported or denied; offline caching still works opportunistically */
  }
}

export async function updateCachedNote(note: Note): Promise<void> {
  if (!localWritesEnabled) return;
  try {
    const existing = await readCachedNote(note.id);
    await set(`${PREFIX}note:${note.id}`, {
      note,
      baseContent: existing?.baseContent ?? note.contentMd,
      cachedAt: Date.now(),
    } satisfies CachedNote);
  } catch {
    /* ignore */
  }
}


/**
 * Remove all locally cached note bodies, drafts, outbox entries and workspace
 * snapshots. Theme/locale preferences are intentionally kept.
 */
export async function clearSensitiveLocalData(): Promise<void> {
  localWritesEnabled = false;
  try {
    await clear();
  } catch {
    /* IndexedDB may be unavailable in private mode */
  }
  try {
    const keysToRemove: string[] = ['nh-auth-cache', 'nh-workspace', 'nh-guest-name'];
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('nh-editor-mode:')) keysToRemove.push(key);
    }
    for (const key of keysToRemove) localStorage.removeItem(key);
  } catch {
    /* ignore storage errors */
  }
}
