import type { Attachment, FolderPathItem, Note, NoteSummary, Role, TagRef } from '@360note/shared';
import { many, one, transaction, type Queryable } from '../db.js';
import { errors } from '../lib/errors.js';
import { excerpt as makeExcerpt, extractWikiLinks, stripTitleHeading, wordCount } from '../lib/text.js';
import { requireWorkspace } from './workspaces.js';

interface NoteRow {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  title: string;
  content_md: string;
  excerpt: string;
  version: number;
  is_favorite: boolean;
  is_pinned: boolean;
  encrypted: boolean;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
  last_opened_at: Date | null;
  trashed_at: Date | null;
  tags: unknown;
  attachment_count?: string;
}

interface AttachmentRow {
  id: string;
  note_id: string;
  filename: string;
  mime: string;
  size_bytes: string;
  width: number | null;
  height: number | null;
  ocr_status: Attachment['ocrStatus'];
  created_at: Date;
}

function mapTags(input: unknown): TagRef[] {
  if (!Array.isArray(input)) return [];
  return input.map((tag) => ({
    id: String((tag as Record<string, unknown>).id),
    name: String((tag as Record<string, unknown>).name),
    color: ((tag as Record<string, unknown>).color as string | null) ?? null,
  }));
}

function mapAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    noteId: row.note_id,
    filename: row.filename,
    mime: row.mime,
    size: Number(row.size_bytes),
    width: row.width,
    height: row.height,
    ocrStatus: row.ocr_status,
    createdAt: row.created_at.toISOString(),
  };
}

export function mapSummary(row: NoteRow): NoteSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    folderId: row.folder_id,
    title: row.title || '未命名笔记',
    excerpt: row.excerpt,
    version: row.version,
    isFavorite: row.is_favorite,
    isPinned: row.is_pinned,
    encrypted: row.encrypted,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    trashedAt: row.trashed_at?.toISOString() ?? null,
    tags: mapTags(row.tags),
    attachmentCount: Number(row.attachment_count ?? 0),
  };
}

const SUMMARY_SELECT = `
  n.*,
  COALESCE((
    SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY lower(t.name))
    FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id
  ), '[]'::json) AS tags,
  (SELECT count(*)::text FROM attachments a WHERE a.note_id = n.id AND a.deleted_at IS NULL) AS attachment_count
`;

export async function getNoteRow(noteId: string, client?: Queryable, forUpdate = false): Promise<NoteRow | null> {
  return one<NoteRow>(
    `SELECT ${SUMMARY_SELECT} FROM notes n WHERE n.id = $1 AND n.deleted_at IS NULL${forUpdate ? ' FOR UPDATE OF n' : ''}`,
    [noteId],
    client,
  );
}

export async function getFolderPath(
  folderId: string | null,
  workspaceId: string,
  client?: Queryable,
): Promise<FolderPathItem[]> {
  if (!folderId) return [];
  const path: FolderPathItem[] = [];
  let current: string | null = folderId;
  for (let depth = 0; current && depth < 32; depth++) {
    const row: { id: string; name: string; parent_id: string | null; trashed_at: Date | null } | null = await one(
      'SELECT id, name, parent_id, trashed_at FROM folders WHERE id = $1 AND workspace_id = $2',
      [current, workspaceId],
    );
    if (!row) break;
    path.unshift({ id: row.id, name: row.name });
    if (row.trashed_at) break;
    current = row.parent_id;
  }
  return path;
}

export async function serializeNote(row: NoteRow, role: Role, client?: Queryable): Promise<Note> {
  const attachments = await many<AttachmentRow>(
    `SELECT id, note_id, filename, mime, size_bytes, width, height, ocr_status, created_at
     FROM attachments WHERE note_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
    [row.id],
    client,
  );
  const canEdit = ['editor', 'admin', 'owner'].includes(role);
  return {
    ...mapSummary(row),
    contentMd: row.content_md,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    folderPath: await getFolderPath(row.folder_id, row.workspace_id, client),
    attachments: attachments.map(mapAttachment),
    wordCount: wordCount(row.content_md),
    canEdit,
    canShare: canEdit,
  };
}

export async function listingNotes(input: {
  workspaceId: string;
  userId: string;
  filter?: string;
  folderId?: string;
  tagId?: string;
  sort?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ notes: NoteSummary[]; total: number }> {
  await requireWorkspace(input.userId, input.workspaceId, 'read');
  const conditions: string[] = ['n.workspace_id = $1', 'n.deleted_at IS NULL'];
  const params: unknown[] = [input.workspaceId];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (input.filter === 'trash') {
    conditions.push('n.trashed_at IS NOT NULL');
  } else {
    conditions.push('n.trashed_at IS NULL');
  }

  if (input.filter === 'favorites') conditions.push('n.is_favorite = true');
  if (input.filter === 'recent') {
    conditions.push(`n.updated_at > now() - interval '30 days'`);
  }
  if (input.filter === 'folder') {
    if (!input.folderId) throw errors.badRequest('缺少文件夹');
    conditions.push(`n.folder_id = ${add(input.folderId)}`);
  }
  if (input.filter === 'tag') {
    if (!input.tagId) throw errors.badRequest('缺少标签');
    const p = add(input.tagId);
    conditions.push(`EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag_id = ${p})`);
  }
  if (input.filter === 'shared') {
    conditions.push(`EXISTS (SELECT 1 FROM share_links sl WHERE sl.note_id = n.id AND sl.revoked_at IS NULL AND (sl.expires_at IS NULL OR sl.expires_at > now()))`);
  }

  if (input.q && input.q.trim()) {
    const q = input.q.trim();
    const p = add(`%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`);
    conditions.push(
      `(n.title ILIKE ${p} OR n.content_md ILIKE ${p} OR EXISTS (
        SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
        WHERE nt.note_id = n.id AND t.name ILIKE ${p}
      ) OR EXISTS (
        SELECT 1 FROM attachments a WHERE a.note_id = n.id AND a.deleted_at IS NULL AND (a.filename ILIKE ${p} OR a.ocr_text ILIKE ${p})
      ))`,
    );
  }

  const order =
    input.sort === 'title'
      ? 'lower(n.title) ASC, n.updated_at DESC'
      : input.sort === 'created'
        ? 'n.created_at DESC'
        : input.sort === 'opened'
          ? 'n.last_opened_at DESC NULLS LAST, n.updated_at DESC'
          : 'n.is_pinned DESC, n.updated_at DESC';

  const limit = Math.min(Math.max(Number(input.limit) || 40, 1), 100);
  const offset = Math.max(Number(input.offset) || 0, 0);
  const where = conditions.join(' AND ');
  const totalRow = await one<{ count: string }>(`SELECT count(*)::text AS count FROM notes n WHERE ${where}`, params);
  const rows = await many<NoteRow>(
    `SELECT ${SUMMARY_SELECT} FROM notes n WHERE ${where} ORDER BY ${order} LIMIT ${add(limit)} OFFSET ${add(offset)}`,
    params,
  );
  return { notes: rows.map(mapSummary), total: Number(totalRow?.count ?? 0) };
}

export async function getRecentFullNotes(workspaceId: string, userId: string, limit = 120): Promise<Note[]> {
  const role = await requireWorkspace(userId, workspaceId, 'read');
  const rows = await many<NoteRow>(
    `SELECT ${SUMMARY_SELECT} FROM notes n
     WHERE n.workspace_id = $1 AND n.deleted_at IS NULL AND n.trashed_at IS NULL
     ORDER BY n.updated_at DESC LIMIT $2`,
    [workspaceId, Math.min(Math.max(limit, 1), 300)],
  );
  const notes: Note[] = [];
  for (const row of rows) {
    try {
      notes.push(await serializeNote(row, role));
    } catch {
      /* skip unreadable note */
    }
  }
  return notes;
}

export async function getNoteForUser(noteId: string, userId: string): Promise<{ note: Note; role: Role; row: NoteRow }> {
  const row = await getNoteRow(noteId);
  if (!row) throw errors.notFound('笔记不存在');
  const role = await requireWorkspace(userId, row.workspace_id, 'read');
  return { note: await serializeNote(row, role), role, row };
}

function untitledTitle(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `未命名笔记 ${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function deriveTitle(title: string | undefined, content: string): string {
  if (title && title.trim()) return title.trim().slice(0, 500);
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim().slice(0, 500);
  const line = content
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  return line ? line.replace(/^[#>*+\-\d.\s]+/, '').slice(0, 160) : untitledTitle();
}

async function validateFolder(
  folderId: string | null | undefined,
  workspaceId: string,
  client?: Queryable,
): Promise<string | null> {
  if (!folderId) return null;
  const folder = await one<{ id: string; trashed_at: Date | null }>(
    'SELECT id, trashed_at FROM folders WHERE id = $1 AND workspace_id = $2',
    [folderId, workspaceId],
    client,
  );
  if (!folder || folder.trashed_at) throw errors.badRequest('目标文件夹不存在');
  return folder.id;
}

export async function rebuildLinks(client: Queryable, noteId: string, workspaceId: string, content: string): Promise<void> {
  await client.query('DELETE FROM note_links WHERE source_note_id = $1', [noteId]);
  const titles = extractWikiLinks(content).slice(0, 500);
  for (const title of titles) {
    await client.query(
      `INSERT INTO note_links (source_note_id, target_note_id, target_title)
       SELECT $1, (SELECT n.id FROM notes n
         WHERE n.workspace_id = $2 AND n.deleted_at IS NULL AND lower(n.title) = lower($3)
         ORDER BY n.updated_at DESC LIMIT 1), $3
       ON CONFLICT (source_note_id, target_title)
       DO UPDATE SET target_note_id = EXCLUDED.target_note_id`,
      [noteId, workspaceId, title],
    );
  }
}

async function setTags(client: Queryable, noteId: string, workspaceId: string, tagIds?: string[], tagNames?: string[]): Promise<void> {
  if (!tagIds && !tagNames) return;
  await client.query('DELETE FROM note_tags WHERE note_id = $1', [noteId]);
  if (tagIds && tagIds.length) {
    await client.query(
      `INSERT INTO note_tags (note_id, tag_id)
       SELECT $1, t.id FROM tags t WHERE t.workspace_id = $2 AND t.id = ANY($3::uuid[])
       ON CONFLICT DO NOTHING`,
      [noteId, workspaceId, tagIds],
    );
  }
  if (tagNames && tagNames.length) {
    for (const name of [...new Set(tagNames.map((value) => value.trim()).filter(Boolean))].slice(0, 50)) {
      const tag = await client.query<{ id: string }>(
        `INSERT INTO tags (workspace_id, name) VALUES ($1, $2)
         ON CONFLICT (workspace_id, lower(name)) DO UPDATE SET name = tags.name
         RETURNING id`,
        [workspaceId, name.slice(0, 80)],
      );
      await client.query('INSERT INTO note_tags (note_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        noteId,
        tag.rows[0].id,
      ]);
    }
  }
}

export async function createNote(input: {
  workspaceId: string;
  userId: string;
  title?: string;
  contentMd?: string;
  folderId?: string | null;
  tagIds?: string[];
  tagNames?: string[];
  reason?: string;
}): Promise<Note> {
  const role = await requireWorkspace(input.userId, input.workspaceId, 'write');
  let content = input.contentMd ?? '';
  const title = deriveTitle(input.title, content);
  content = stripTitleHeading(content, title);
  const folderId = await validateFolder(input.folderId, input.workspaceId);
  const note = await transaction(async (client) => {
    const row = await client.query<NoteRow>(
      `INSERT INTO notes (workspace_id, folder_id, title, content_md, excerpt, version, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $6) RETURNING *`,
      [input.workspaceId, folderId, title, content, makeExcerpt(content), input.userId],
    );
    const noteId = row.rows[0].id;
    await client.query(
      `INSERT INTO note_versions (note_id, version, title, content_md, reason, created_by)
       VALUES ($1, 1, $2, $3, 'auto', $4) ON CONFLICT DO NOTHING`,
      [noteId, title, content, input.userId],
    );
    await setTags(client, noteId, input.workspaceId, input.tagIds, input.tagNames);
    await rebuildLinks(client, noteId, input.workspaceId, content);
    return getNoteRow(noteId, client);
  });
  return serializeNote(note!, role);
}

async function snapshotVersion(
  client: Queryable,
  noteId: string,
  version: number,
  title: string,
  content: string,
  userId: string,
  reason: 'auto' | 'manual' | 'restore' | 'import' | 'conflict',
  force = false,
): Promise<void> {
  if (!force) {
    const recent = await one<{ created_at: Date }>(
      'SELECT created_at FROM note_versions WHERE note_id = $1 ORDER BY version DESC LIMIT 1',
      [noteId],
      client,
    );
    if (recent && Date.now() - recent.created_at.getTime() < 5 * 60 * 1000) return;
  }
  await client.query(
    `INSERT INTO note_versions (note_id, version, title, content_md, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (note_id, version) DO NOTHING`,
    [noteId, version, title, content, reason, userId],
  );
  await client.query(
    `DELETE FROM note_versions WHERE note_id = $1 AND id NOT IN (
      SELECT id FROM note_versions WHERE note_id = $1 ORDER BY version DESC LIMIT 60
    )`,
    [noteId],
  );
}

export async function addConflictVersion(input: {
  noteId: string;
  userId: string;
  title: string;
  contentMd: string;
}): Promise<{ version: number }> {
  const existing = await getNoteRow(input.noteId);
  if (!existing) throw errors.notFound('笔记不存在');
  await requireWorkspace(input.userId, existing.workspace_id, 'write');
  const version = await transaction(async (client) => {
    // Serialize concurrent conflict saves for the same note; the unique
    // (note_id, version) index must never turn a preserved snapshot into a 500.
    const note = await client.query<{ version: number }>(
      'SELECT version FROM notes WHERE id = $1 FOR UPDATE',
      [input.noteId],
    );
    if (!note.rowCount) throw errors.notFound('笔记不存在');
    const max = await client.query<{ max: string }>(
      'SELECT COALESCE(max(version), 0)::text AS max FROM note_versions WHERE note_id = $1',
      [input.noteId],
    );
    const next = Math.max(note.rows[0].version, Number(max.rows[0]?.max ?? 0)) + 1;
    await client.query(
      `INSERT INTO note_versions (note_id, version, title, content_md, reason, created_by)
       VALUES ($1, $2, $3, $4, 'conflict', $5)`,
      [input.noteId, next, input.title.slice(0, 500) || '未命名笔记', input.contentMd, input.userId],
    );
    await client.query(
      `DELETE FROM note_versions WHERE note_id = $1 AND id NOT IN (
         SELECT id FROM note_versions WHERE note_id = $1 ORDER BY version DESC LIMIT 60
       )`,
      [input.noteId],
    );
    return next;
  });
  return { version };
}

export async function updateNote(input: {
  noteId: string;
  userId: string;
  baseVersion?: number;
  title?: string;
  contentMd?: string;
  folderId?: string | null;
  isFavorite?: boolean;
  isPinned?: boolean;
  tagIds?: string[];
  tagNames?: string[];
  reason?: 'auto' | 'manual' | 'restore' | 'import' | 'conflict';
  touchOpened?: boolean;
}): Promise<{ note: Note; linkUpdates: number }> {
  const initial = await getNoteRow(input.noteId);
  if (!initial) throw errors.notFound('笔记不存在');
  const role = await requireWorkspace(input.userId, initial.workspace_id, 'write');
  if (initial.trashed_at) throw errors.badRequest('请先恢复这篇笔记');

  const result = await transaction(async (client) => {
    // Lock the note before reading its version. Concurrent saves queue on this
    // row; the second one sees the first one's committed version and gets 409
    // instead of silently overwriting it.
    const locked = await getNoteRow(input.noteId, client, true);
    if (!locked) throw errors.notFound('笔记不存在');
    if (locked.trashed_at) throw errors.badRequest('请先恢复这篇笔记');

    if (input.baseVersion !== undefined && input.baseVersion !== locked.version) {
      throw errors.conflict('这篇笔记已在其他设备更新', {
        code: 'VERSION_CONFLICT',
        current: await serializeNote(locked, role, client),
        baseVersion: input.baseVersion,
      });
    }

    const folderId =
      input.folderId === undefined
        ? locked.folder_id
        : await validateFolder(input.folderId, locked.workspace_id, client);
    const title =
      input.title === undefined ? locked.title : (input.title.trim().slice(0, 500) || untitledTitle());
    let content = input.contentMd === undefined ? locked.content_md : input.contentMd;
    content = stripTitleHeading(content, title);
    const oldTitle = locked.title;
    const reason = input.reason ?? 'auto';
    const forceSnapshot = reason !== 'auto';
    const version = locked.version + 1;

    const row = await client.query<NoteRow>(
      `UPDATE notes SET title = $2, content_md = $3, excerpt = $4, folder_id = $5,
         is_favorite = COALESCE($6, is_favorite), is_pinned = COALESCE($7, is_pinned),
         version = $8, updated_by = $9, updated_at = now(),
         last_opened_at = CASE WHEN $10 THEN now() ELSE last_opened_at END
       WHERE id = $1 AND version = $11 RETURNING *`,
      [
        input.noteId,
        title,
        content,
        makeExcerpt(content),
        folderId,
        input.isFavorite ?? null,
        input.isPinned ?? null,
        version,
        input.userId,
        input.touchOpened ?? false,
        locked.version,
      ],
    );
    if (row.rowCount !== 1) {
      const currentRow = await getNoteRow(input.noteId, client);
      throw errors.conflict('这篇笔记已在其他设备更新', {
        code: 'VERSION_CONFLICT',
        current: currentRow ? await serializeNote(currentRow, role, client) : null,
        baseVersion: input.baseVersion,
      });
    }

    await setTags(client, input.noteId, locked.workspace_id, input.tagIds, input.tagNames);
    await rebuildLinks(client, input.noteId, locked.workspace_id, content);
    await snapshotVersion(client, input.noteId, version, title, content, input.userId, reason, forceSnapshot);

    const fresh = await getNoteRow(input.noteId, client);
    if (!fresh) throw errors.notFound('笔记不存在');
    return {
      note: await serializeNote(fresh, role, client),
      oldTitle,
      title,
      workspaceId: locked.workspace_id,
    };
  });

  let linkUpdates = 0;
  if (result.oldTitle && result.title !== result.oldTitle) {
    linkUpdates = await propagateTitleRename(result.workspaceId, input.userId, result.oldTitle, result.title, input.noteId);
  }
  return { note: result.note, linkUpdates };
}

/** Rename wiki links that point at a renamed note. Runs after the note update. */
export async function propagateTitleRename(
  workspaceId: string,
  userId: string,
  oldTitle: string,
  newTitle: string,
  renamedNoteId: string,
): Promise<number> {
  if (!oldTitle.trim() || !newTitle.trim() || oldTitle === newTitle) return 0;
  const rows = await many<{ id: string; title: string; content_md: string; version: number }>(
    `SELECT id, title, content_md, version FROM notes
     WHERE workspace_id = $1 AND deleted_at IS NULL AND id <> $2
       AND content_md ILIKE '%[[' || $3 || ']]%' ESCAPE '\\'
     LIMIT 2000`,
    [workspaceId, renamedNoteId, oldTitle],
  );
  let count = 0;
  for (const row of rows) {
    const pattern = new RegExp(
      `\\[\\[${oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\|[^\\]]*)?\\]\\]`,
      'g',
    );
    const content = row.content_md.replace(pattern, (_match, alias: string | undefined) => `[[${newTitle}${alias ?? ''}]]`);
    if (content === row.content_md) continue;
    await transaction(async (client) => {
      const version = row.version + 1;
      await client.query(
        `UPDATE notes SET content_md = $2, excerpt = $3, version = $4, updated_by = $5, updated_at = now() WHERE id = $1`,
        [row.id, content, makeExcerpt(content), version, userId],
      );
      await rebuildLinks(client, row.id, workspaceId, content);
      await snapshotVersion(client, row.id, version, row.title, content, userId, 'auto', false);
    });
    count++;
  }
  return count;
}

export async function trashNote(noteId: string, userId: string): Promise<void> {
  const row = await getNoteRow(noteId);
  if (!row) throw errors.notFound('笔记不存在');
  await requireWorkspace(userId, row.workspace_id, 'write');
  await one('UPDATE notes SET trashed_at = now(), updated_at = now() WHERE id = $1 RETURNING id', [noteId]);
}

export async function restoreNote(noteId: string, userId: string): Promise<Note> {
  const row = await getNoteRow(noteId);
  if (!row) throw errors.notFound('笔记不存在');
  const role = await requireWorkspace(userId, row.workspace_id, 'write');
  let folderId = row.folder_id;
  if (folderId) {
    const folder = await one<{ trashed_at: Date | null }>('SELECT trashed_at FROM folders WHERE id = $1', [folderId]);
    if (!folder || folder.trashed_at) folderId = null;
  }
  const restored = await one<NoteRow>(
    `UPDATE notes SET trashed_at = NULL, folder_id = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [noteId, folderId],
  );
  const fresh = (await getNoteRow(noteId)) ?? restored!;
  return serializeNote(fresh, role);
}

export async function deleteNotePermanently(noteId: string, userId: string): Promise<string[]> {
  const row = await getNoteRow(noteId);
  if (!row) throw errors.notFound('笔记不存在');
  await requireWorkspace(userId, row.workspace_id, 'write');
  const attachments = await many<{ storage_key: string }>(
    'SELECT storage_key FROM attachments WHERE note_id = $1',
    [noteId],
  );
  await one('DELETE FROM notes WHERE id = $1 RETURNING id', [noteId]);
  return attachments.map((attachment) => attachment.storage_key);
}

export async function emptyTrash(workspaceId: string, userId: string): Promise<string[]> {
  await requireWorkspace(userId, workspaceId, 'write');
  const attachments = await many<{ storage_key: string }>(
    `SELECT a.storage_key FROM attachments a JOIN notes n ON n.id = a.note_id
     WHERE n.workspace_id = $1 AND n.trashed_at IS NOT NULL`,
    [workspaceId],
  );
  await one('DELETE FROM notes WHERE workspace_id = $1 AND trashed_at IS NOT NULL RETURNING id', [workspaceId]);
  await one('DELETE FROM folders WHERE workspace_id = $1 AND trashed_at IS NOT NULL RETURNING id', [workspaceId]);
  return attachments.map((attachment) => attachment.storage_key);
}

export async function listVersions(noteId: string, userId: string) {
  const { role, row } = await getNoteForUser(noteId, userId);
  void role;
  const rows = await many<{
    id: string;
    version: number;
    title: string;
    content_md: string;
    reason: string;
    created_at: Date;
    author_name: string | null;
  }>(
    `SELECT v.id, v.version, v.title, v.content_md, v.reason, v.created_at, u.display_name AS author_name
     FROM note_versions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.note_id = $1 ORDER BY v.version DESC`,
    [noteId],
  );
  return {
    currentVersion: row.version,
    versions: rows.map((version) => ({
      id: Number(version.id),
      noteId,
      version: version.version,
      title: version.title,
      createdAt: version.created_at.toISOString(),
      reason: version.reason as 'auto' | 'manual' | 'restore' | 'import' | 'conflict',
      authorName: version.author_name ?? undefined,
      preview: makeExcerpt(version.content_md, 120),
    })),
  };
}

export async function getVersion(noteId: string, versionId: number, userId: string) {
  await getNoteForUser(noteId, userId);
  const row = await many<{
    id: string;
    version: number;
    title: string;
    content_md: string;
    reason: string;
    created_at: Date;
    author_name: string | null;
  }>(
    `SELECT v.id, v.version, v.title, v.content_md, v.reason, v.created_at, u.display_name AS author_name
     FROM note_versions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.note_id = $1 AND v.id = $2`,
    [noteId, versionId],
  );
  if (!row[0]) throw errors.notFound('版本不存在');
  return {
    id: Number(row[0].id),
    noteId,
    version: row[0].version,
    title: row[0].title,
    contentMd: row[0].content_md,
    createdAt: row[0].created_at.toISOString(),
    reason: row[0].reason,
    authorName: row[0].author_name ?? undefined,
  };
}

export async function restoreVersion(noteId: string, versionId: number, userId: string): Promise<Note> {
  const version = await getVersion(noteId, versionId, userId);
  const result = await updateNote({
    noteId,
    userId,
    title: version.title,
    contentMd: version.contentMd,
    reason: 'restore',
  });
  return result.note;
}

export async function getBacklinks(noteId: string, userId: string) {
  const { row } = await getNoteForUser(noteId, userId);
  const rows = await many<{ id: string; title: string; excerpt: string; updated_at: Date }>(
    `SELECT DISTINCT n.id, n.title, n.excerpt, n.updated_at
     FROM note_links l JOIN notes n ON n.id = l.source_note_id
     WHERE (l.target_note_id = $1 OR (l.target_note_id IS NULL AND lower(l.target_title) = lower($2)))
       AND n.workspace_id = $3
       AND n.deleted_at IS NULL AND n.trashed_at IS NULL
     ORDER BY n.updated_at DESC LIMIT 200`,
    [noteId, row.title, row.workspace_id],
  );
  return rows.map((entry) => ({
    id: entry.id,
    title: entry.title || '未命名笔记',
    excerpt: entry.excerpt,
    updatedAt: entry.updated_at.toISOString(),
  }));
}

export async function duplicateNote(noteId: string, userId: string): Promise<Note> {
  const { row } = await getNoteForUser(noteId, userId);
  const tags = await many<{ tag_id: string }>('SELECT tag_id FROM note_tags WHERE note_id = $1', [noteId]);
  return createNote({
    workspaceId: row.workspace_id,
    userId,
    title: `${row.title} 副本`,
    contentMd: row.content_md,
    folderId: row.folder_id,
    tagIds: tags.map((tag) => tag.tag_id),
  });
}

export async function updateLastOpened(noteId: string, userId: string): Promise<void> {
  const row = await getNoteRow(noteId);
  if (!row) return;
  await requireWorkspace(userId, row.workspace_id, 'read');
  await one('UPDATE notes SET last_opened_at = now() WHERE id = $1 RETURNING id', [noteId]);
}
