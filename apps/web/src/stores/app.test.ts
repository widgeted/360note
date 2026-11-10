import { describe, expect, it, vi } from 'vitest';
import type { Note } from '@360note/shared';

function note(id: string): Note {
  return {
    id,
    workspaceId: '00000000-0000-0000-0000-000000000000',
    folderId: null,
    title: 'Test',
    contentMd: 'body',
    excerpt: 'body',
    version: 3,
    isFavorite: false,
    isPinned: false,
    encrypted: false,
    canEdit: true,
    canShare: true,
    canManage: false,
    tags: [],
    folderPath: [],
    attachmentCount: 0,
    commentCount: 0,
    backlinkCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trashedAt: null,
  } as unknown as Note;
}

describe('saveNote route guard', () => {
  it('refuses to save after the open note changed', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubGlobal('navigator', { onLine: true });
    const { useAppStore } = await import('./app');
    const current = note('11111111-1111-1111-1111-111111111111');
    useAppStore.setState({ note: current, notes: [], pendingCount: 0 });
    const result = await useAppStore.getState().saveNote({
      noteId: '22222222-2222-2222-2222-222222222222',
      title: 'stale',
      contentMd: 'stale body',
      baseVersion: current.version,
    });
    expect(result).toEqual({ ok: false, error: 'note-changed' });
    expect(useAppStore.getState().note?.contentMd).toBe('body');
  });
});
