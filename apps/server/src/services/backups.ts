import AdmZip from 'adm-zip';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { many, one, query, transaction } from '../db.js';
import { config, paths } from '../config.js';
import { errors } from '../lib/errors.js';
import { excerpt } from '../lib/text.js';
import {
  attachmentStorageKey,
  backupStorageKey,
  deleteAttachment,
  deleteBackupFile,
  readAttachment,
  readBackup,
  safeFilename,
  saveAttachment,
  saveBackup,
} from '../lib/storage.js';
import { updateJob } from '../lib/jobs.js';
import type { ParsedImport, ParsedNote, ParsedAttachment } from '../lib/import-parser.js';
import { executeImport } from './import.js';
import { requireWorkspace } from './workspaces.js';
import { audit } from '../lib/audit.js';
import { deleteOffsiteBackup, getOffsiteConfig, uploadOffsiteBackup } from './offsite.js';

interface BackupNote {
  id: string;
  title: string;
  contentMd: string;
  folderId: string | null;
  version: number;
  isFavorite: boolean;
  isPinned: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface BackupFolder {
  id: string;
  parentId: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  position: number;
}

interface BackupTag {
  id: string;
  name: string;
  color: string | null;
}

interface BackupAttachment {
  id: string;
  noteId: string;
  filename: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  createdBy: string;
  createdAt: string;
  zipPath: string;
}

interface BackupVersion {
  noteId: string;
  version: number;
  title: string;
  contentMd: string;
  reason: string;
  createdBy: string | null;
  createdAt: string;
}

interface BackupComment {
  noteId: string;
  guestName: string | null;
  userId: string | null;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BackupDocument {
  format: '360note-backup';
  version: 1;
  createdAt: string;
  workspace: { id: string; name: string };
  counts: { notes: number; folders: number; tags: number; attachments: number };
  folders: BackupFolder[];
  tags: BackupTag[];
  notes: BackupNote[];
  noteTags: Array<{ noteId: string; tagId: string }>;
  attachments: BackupAttachment[];
  versions: BackupVersion[];
  comments: BackupComment[];
}

/** Hard limits for attacker-controlled backup archives. */
export const BACKUP_LIMITS = {
  maxEntries: 5000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 500,
} as const;

interface BackupPreview {
  format: '360note-backup';
  version: number;
  createdAt: string;
  workspace: { id: string; name: string };
  counts: { notes: number; folders: number; tags: number; attachments: number; versions: number; comments: number };
  sameWorkspace: boolean;
  warnings: string[];
}

function backupFilename(workspaceName: string, kind: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `${kind}-${safeFilename(workspaceName).slice(0, 40)}-${stamp}.3nb`;
}

export async function createBackupDocument(workspaceId: string): Promise<{ buffer: Buffer; document: BackupDocument; name: string }> {
  const workspace = await one<{ id: string; name: string }>('SELECT id, name FROM workspaces WHERE id = $1 AND deleted_at IS NULL', [workspaceId]);
  if (!workspace) throw errors.notFound('工作区不存在');
  const folders = await many<{
    id: string;
    parent_id: string | null;
    name: string;
    color: string | null;
    icon: string | null;
    position: number;
  }>('SELECT id, parent_id, name, color, icon, position FROM folders WHERE workspace_id = $1 AND trashed_at IS NULL ORDER BY position, created_at', [workspaceId]);
  const tags = await many<{ id: string; name: string; color: string | null }>(
    'SELECT id, name, color FROM tags WHERE workspace_id = $1 ORDER BY lower(name)',
    [workspaceId],
  );
  const notes = await many<{
    id: string;
    title: string;
    content_md: string;
    folder_id: string | null;
    version: number;
    is_favorite: boolean;
    is_pinned: boolean;
    created_by: string;
    updated_by: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, title, content_md, folder_id, version, is_favorite, is_pinned, created_by, updated_by, created_at, updated_at
     FROM notes WHERE workspace_id = $1 AND trashed_at IS NULL AND deleted_at IS NULL ORDER BY created_at`,
    [workspaceId],
  );
  const noteIds = notes.map((note) => note.id);
  const noteTags = noteIds.length
    ? await many<{ note_id: string; tag_id: string }>('SELECT note_id, tag_id FROM note_tags WHERE note_id = ANY($1::uuid[])', [noteIds])
    : [];
  const attachmentRows = noteIds.length
    ? await many<{
        id: string;
        note_id: string;
        filename: string;
        mime: string;
        size_bytes: string;
        width: number | null;
        height: number | null;
        storage_key: string;
        created_by: string;
        created_at: Date;
      }>(
        `SELECT id, note_id, filename, mime, size_bytes, width, height, storage_key, created_by, created_at
         FROM attachments WHERE note_id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY created_at`,
        [noteIds],
      )
    : [];
  const versions = noteIds.length
    ? await many<{
        note_id: string;
        version: number;
        title: string;
        content_md: string;
        reason: string;
        created_by: string | null;
        created_at: Date;
      }>(
        'SELECT note_id, version, title, content_md, reason, created_by, created_at FROM note_versions WHERE note_id = ANY($1::uuid[]) ORDER BY note_id, version',
        [noteIds],
      )
    : [];
  const comments = noteIds.length
    ? await many<{
        note_id: string;
        guest_name: string | null;
        user_id: string | null;
        body: string;
        resolved: boolean;
        created_at: Date;
        updated_at: Date;
      }>(
        'SELECT note_id, guest_name, user_id, body, resolved, created_at, updated_at FROM comments WHERE note_id = ANY($1::uuid[]) ORDER BY created_at',
        [noteIds],
      )
    : [];

  const document: BackupDocument = {
    format: '360note-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    workspace,
    counts: { notes: notes.length, folders: folders.length, tags: tags.length, attachments: attachmentRows.length },
    folders: folders.map((folder) => ({
      id: folder.id,
      parentId: folder.parent_id,
      name: folder.name,
      color: folder.color,
      icon: folder.icon,
      position: folder.position,
    })),
    tags,
    notes: notes.map((note) => ({
      id: note.id,
      title: note.title,
      contentMd: note.content_md,
      folderId: note.folder_id,
      version: note.version,
      isFavorite: note.is_favorite,
      isPinned: note.is_pinned,
      createdBy: note.created_by,
      updatedBy: note.updated_by,
      createdAt: note.created_at.toISOString(),
      updatedAt: note.updated_at.toISOString(),
    })),
    noteTags: noteTags.map((row) => ({ noteId: row.note_id, tagId: row.tag_id })),
    attachments: attachmentRows.map((attachment) => ({
      id: attachment.id,
      noteId: attachment.note_id,
      filename: attachment.filename,
      mime: attachment.mime,
      size: Number(attachment.size_bytes),
      width: attachment.width,
      height: attachment.height,
      createdBy: attachment.created_by,
      createdAt: attachment.created_at.toISOString(),
      zipPath: `attachments/${attachment.id}/${safeFilename(attachment.filename)}`,
    })),
    versions: versions.map((version) => ({
      noteId: version.note_id,
      version: version.version,
      title: version.title,
      contentMd: version.content_md,
      reason: version.reason,
      createdBy: version.created_by,
      createdAt: version.created_at.toISOString(),
    })),
    comments: comments.map((comment) => ({
      noteId: comment.note_id,
      guestName: comment.guest_name,
      userId: comment.user_id,
      body: comment.body,
      resolved: comment.resolved,
      createdAt: comment.created_at.toISOString(),
      updatedAt: comment.updated_at.toISOString(),
    })),
  };

  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({
    format: '360note-backup',
    version: 1,
    createdAt: document.createdAt,
    workspace: document.workspace,
    counts: document.counts,
  }, null, 2)));
  zip.addFile('workspace.json', Buffer.from(JSON.stringify(document, null, 2)));
  for (const attachment of attachmentRows) {
    try {
      const data = await readAttachment(attachment.storage_key);
      zip.addFile(`attachments/${attachment.id}/${safeFilename(attachment.filename)}`, data);
    } catch (error) {
      console.warn('[backup] could not read attachment', attachment.id, error);
    }
  }
  return { buffer: zip.toBuffer(), document, name: backupFilename(workspace.name, 'backup') };
}

export async function createBackup(input: {
  workspaceId: string;
  userId: string;
  kind: 'auto' | 'manual' | 'pre-restore';
  jobId?: string;
}): Promise<{ id: string; name: string; size: number; offsite?: 'uploaded' | 'disabled' | 'failed' }> {
  const role = await requireWorkspace(input.userId, input.workspaceId, input.kind === 'pre-restore' ? 'read' : 'manage');
  void role;
  if (input.jobId) {
    const existing = await one<{ id: string; filename: string; size_bytes: string; meta: Record<string, unknown> | null }>(
      'SELECT id, filename, size_bytes, meta FROM backups WHERE job_id = $1 AND workspace_id = $2',
      [input.jobId, input.workspaceId],
    );
    if (existing) {
      return {
        id: existing.id,
        name: existing.filename,
        size: Number(existing.size_bytes),
        offsite: (existing.meta?.offsite as 'uploaded' | 'disabled' | 'failed' | undefined) ?? 'disabled',
      };
    }
  }
  const { buffer, document, name } = await createBackupDocument(input.workspaceId);
  const encryptedSize = await saveBackup(name, buffer);
  try {
    // Verify decryption and ZIP structure before publishing the backup row.
    const stored = await readBackup(name);
    const preview = previewBackup(stored, input.workspaceId);
    if (
      preview.counts.notes !== document.counts.notes ||
      preview.counts.attachments !== document.counts.attachments ||
      preview.workspace.id !== input.workspaceId
    ) {
      throw new Error('备份校验失败：内容与清单不一致');
    }
  } catch (error) {
    await deleteBackupFile(name).catch(() => {});
    throw error;
  }
  const row = await one<{ id: string; created_at: Date }>(
    `INSERT INTO backups (workspace_id, filename, storage_key, size_bytes, kind, status, note_count, attachment_count, meta, created_by, job_id)
     VALUES ($1, $2, $3, $4, $5, 'ready', $6, $7, $8, $9, $10) RETURNING id, created_at`,
    [
      input.workspaceId,
      name,
      backupStorageKey(name),
      encryptedSize,
      input.kind,
      document.counts.notes,
      document.counts.attachments,
      JSON.stringify({ createdAt: document.createdAt, folderCount: document.counts.folders, tagCount: document.counts.tags }),
      input.userId,
      input.jobId ?? null,
    ],
  );
  if (input.jobId) await updateJob(input.jobId, { progress: 82, message: '正在处理异地备份…' });
  const offsiteConfig = await getOffsiteConfig();
  let offsite: 'disabled' | 'uploaded' | 'failed' = 'disabled';
  if (offsiteConfig.enabled) {
    offsite = await uploadOffsiteBackup(name);
    await one(
      `UPDATE backups SET meta = jsonb_set(meta, '{offsite}', to_jsonb($2::text)) WHERE id = $1 RETURNING id`,
      [row!.id, offsite],
    );
  }
  if (input.jobId) await updateJob(input.jobId, { progress: 90, message: '正在清理旧备份…' });
  await pruneBackups(input.workspaceId);
  return { id: row!.id, name, size: encryptedSize, offsite };
}

export async function pruneBackups(workspaceId: string): Promise<void> {
  const rows = await many<{ id: string; filename: string; kind: string; created_at: Date }>(
    `SELECT id, filename, kind, created_at FROM backups WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId],
  );
  const keepAuto = 14;
  let autoSeen = 0;
  const remove: typeof rows = [];
  for (const row of rows) {
    if (row.kind === 'auto') {
      autoSeen++;
      if (autoSeen > keepAuto) {
        remove.push(row);
        continue;
      }
    }
    if (Date.now() - row.created_at.getTime() > config.backupRetentionDays * 24 * 60 * 60 * 1000) {
      remove.push(row);
    }
  }
  for (const row of remove) {
    await one('DELETE FROM backups WHERE id = $1 RETURNING id', [row.id]);
    await deleteOffsiteBackup(row.filename).catch(() => {});
    await deleteBackupFile(row.filename).catch(() => {});
  }
}

export async function listBackups(workspaceId: string, userId: string) {
  await requireWorkspace(userId, workspaceId, 'read');
  const rows = await many<{
    id: string;
    filename: string;
    size_bytes: string;
    kind: string;
    status: string;
    note_count: number;
    attachment_count: number;
    created_at: Date;
    meta: Record<string, unknown> | null;
  }>(
    `SELECT id, filename, size_bytes, kind, status, note_count, attachment_count, created_at, meta
     FROM backups WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId],
  );
  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    size: Number(row.size_bytes),
    kind: row.kind,
    status: row.status,
    noteCount: row.note_count,
    attachmentCount: row.attachment_count,
    createdAt: row.created_at.toISOString(),
    offsite: (row.meta?.offsite as string | undefined) ?? 'disabled',
  }));
}

function inspectBackupZip(zip: AdmZip): void {
  let entries: AdmZip.IZipEntry[];
  try {
    entries = zip.getEntries();
  } catch {
    throw errors.badRequest('备份文件已损坏');
  }
  if (entries.length > BACKUP_LIMITS.maxEntries) {
    throw errors.badRequest('备份文件包含过多条目');
  }
  let total = 0;
  for (const entry of entries) {
    const size = entry.header.size;
    const compressed = entry.header.compressedSize;
    if (!Number.isFinite(size) || size < 0 || !Number.isFinite(compressed) || compressed < 0) {
      throw errors.badRequest('备份文件已损坏');
    }
    if (size > BACKUP_LIMITS.maxEntryBytes) {
      throw errors.badRequest('备份文件中的单个文件过大');
    }
    total += size;
    if (total > BACKUP_LIMITS.maxTotalBytes) {
      throw errors.badRequest('备份文件解压后过大');
    }
    if (size > 1024 * 1024 && (compressed === 0 || size / compressed > BACKUP_LIMITS.maxCompressionRatio)) {
      throw errors.badRequest('备份文件压缩比异常');
    }
  }
}

function readEntryData(entry: AdmZip.IZipEntry): Buffer {
  const data = entry.getData();
  if (data.length > BACKUP_LIMITS.maxEntryBytes) {
    throw errors.badRequest('备份文件中的单个文件过大');
  }
  return data;
}

function validateBackupDocument(document: BackupDocument): void {
  if (
    !document ||
    typeof document !== 'object' ||
    !document.workspace ||
    typeof document.workspace.id !== 'string' ||
    typeof document.workspace.name !== 'string' ||
    !document.counts ||
    typeof document.counts !== 'object' ||
    !Array.isArray(document.folders) ||
    !Array.isArray(document.tags) ||
    !Array.isArray(document.notes) ||
    !Array.isArray(document.noteTags) ||
    !Array.isArray(document.attachments) ||
    !Array.isArray(document.versions) ||
    !Array.isArray(document.comments)
  ) {
    throw errors.badRequest('备份文件内容无法解析');
  }
  for (const collection of [
    document.folders,
    document.tags,
    document.notes,
    document.noteTags,
    document.attachments,
    document.versions,
    document.comments,
  ]) {
    if (collection.length > 100_000) throw errors.badRequest('备份文件包含过多条目');
  }
}

function readBackupZip(buffer: Buffer): { zip: AdmZip; manifest: Record<string, unknown>; document: BackupDocument } {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw errors.badRequest('备份文件已损坏');
  }
  inspectBackupZip(zip);
  const manifestEntry = zip.getEntry('manifest.json');
  const documentEntry = zip.getEntry('workspace.json');
  if (!manifestEntry || !documentEntry) throw errors.badRequest('不是有效的 360note 备份文件');
  let manifest: Record<string, unknown>;
  let document: BackupDocument;
  try {
    manifest = JSON.parse(readEntryData(manifestEntry).toString('utf8'));
    document = JSON.parse(readEntryData(documentEntry).toString('utf8'));
  } catch (error) {
    if (error instanceof Error && error.name === 'AppError') throw error;
    throw errors.badRequest('备份文件内容无法解析');
  }
  if (manifest.format !== '360note-backup' || document.format !== '360note-backup') {
    throw errors.badRequest('备份格式不受支持');
  }
  validateBackupDocument(document);
  return { zip, manifest, document };
}

export function previewBackup(buffer: Buffer, targetWorkspaceId: string): BackupPreview {
  const { document } = readBackupZip(buffer);
  const warnings: string[] = [];
  if (document.workspace.id !== targetWorkspaceId) {
    warnings.push('这份备份来自另一个工作区，只能以“合并副本”方式恢复。');
  }
  if (!document.notes.length) warnings.push('备份中没有笔记。');
  return {
    format: '360note-backup',
    version: document.version,
    createdAt: document.createdAt,
    workspace: document.workspace,
    counts: {
      notes: document.counts.notes,
      folders: document.counts.folders,
      tags: document.counts.tags,
      attachments: document.counts.attachments,
      versions: document.versions.length,
      comments: document.comments.length,
    },
    sameWorkspace: document.workspace.id === targetWorkspaceId,
    warnings,
  };
}

async function restoreReplace(input: {
  workspaceId: string;
  userId: string;
  buffer: Buffer;
  jobId: string;
}): Promise<Record<string, unknown>> {
  const { zip, document } = readBackupZip(input.buffer);
  await requireWorkspace(input.userId, input.workspaceId, 'manage');
  if (document.workspace.id !== input.workspaceId) throw errors.badRequest('只能替换恢复到备份来源的工作区');
  const userRows = await many<{ id: string }>('SELECT id FROM users');
  const userIds = new Set(userRows.map((row) => row.id));
  const oldAttachmentKeys = await many<{ storage_key: string }>(
    'SELECT storage_key FROM attachments WHERE workspace_id = $1',
    [input.workspaceId],
  );
  const newStorageKeys = new Set<string>();

  await transaction(async (client) => {
    await client.query('DELETE FROM notes WHERE workspace_id = $1', [input.workspaceId]);
    await client.query('DELETE FROM folders WHERE workspace_id = $1', [input.workspaceId]);
    await client.query('DELETE FROM tags WHERE workspace_id = $1', [input.workspaceId]);
    await client.query('DELETE FROM comments WHERE note_id NOT IN (SELECT id FROM notes)');
    // Folders first without parents, then wire the tree.
    for (const folder of document.folders) {
      await client.query(
        `INSERT INTO folders (id, workspace_id, parent_id, name, color, icon, position, created_at, updated_at)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $7) ON CONFLICT (id) DO NOTHING`,
        [folder.id, input.workspaceId, folder.name, folder.color, folder.icon, folder.position, document.createdAt],
      );
    }
    for (const folder of document.folders) {
      if (folder.parentId) {
        await client.query('UPDATE folders SET parent_id = $2 WHERE id = $1', [folder.id, folder.parentId]);
      }
    }
    for (const tag of document.tags) {
      await client.query(
        `INSERT INTO tags (id, workspace_id, name, color, created_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [tag.id, input.workspaceId, tag.name, tag.color, document.createdAt],
      );
    }
    for (const note of document.notes) {
      const createdBy = userIds.has(note.createdBy) ? note.createdBy : input.userId;
      const updatedBy = userIds.has(note.updatedBy) ? note.updatedBy : input.userId;
      await client.query(
        `INSERT INTO notes (id, workspace_id, folder_id, title, content_md, excerpt, version, is_favorite, is_pinned,
           created_by, updated_by, created_at, updated_at, encrypted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false)
         ON CONFLICT (id) DO NOTHING`,
        [
          note.id, input.workspaceId, note.folderId, note.title, note.contentMd, excerpt(note.contentMd), note.version,
          note.isFavorite, note.isPinned, createdBy, updatedBy, note.createdAt, note.updatedAt,
        ],
      );
    }
    for (const link of document.noteTags) {
      await client.query(
        `INSERT INTO note_tags (note_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [link.noteId, link.tagId],
      );
    }
    for (const version of document.versions) {
      await client.query(
        `INSERT INTO note_versions (note_id, version, title, content_md, reason, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (note_id, version) DO NOTHING`,
        [
          version.noteId, version.version, version.title, version.contentMd, version.reason,
          version.createdBy && userIds.has(version.createdBy) ? version.createdBy : null, version.createdAt,
        ],
      );
    }
    for (const comment of document.comments) {
      await client.query(
        `INSERT INTO comments (note_id, guest_name, user_id, body, resolved, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          comment.noteId, comment.guestName, comment.userId && userIds.has(comment.userId) ? comment.userId : null,
          comment.body, comment.resolved, comment.createdAt, comment.updatedAt,
        ],
      );
    }
    // Rebuild wiki links for restored notes.
    for (const note of document.notes) {
      await client.query('DELETE FROM note_links WHERE source_note_id = $1', [note.id]);
      const titles = [...note.contentMd.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) => match[1].trim());
      for (const title of [...new Set(titles)].slice(0, 500)) {
        await client.query(
          `INSERT INTO note_links (source_note_id, target_note_id, target_title)
           SELECT $1, (SELECT id FROM notes WHERE workspace_id = $2 AND lower(title) = lower($3) LIMIT 1), $3
           ON CONFLICT (source_note_id, target_title) DO UPDATE SET target_note_id = EXCLUDED.target_note_id`,
          [note.id, input.workspaceId, title],
        );
      }
    }
    await client.query('UPDATE workspaces SET updated_at = now() WHERE id = $1', [input.workspaceId]);
  });

  for (const attachment of document.attachments) {
    const entry = zip.getEntry(attachment.zipPath);
    if (!entry) continue;
    const data = readEntryData(entry);
    const localKey = attachmentStorageKey(input.workspaceId, attachment.id);
    const storageKey = await saveAttachment(localKey, data);
    newStorageKeys.add(storageKey);
    const createdBy = userIds.has(attachment.createdBy) ? attachment.createdBy : input.userId;
    await one(
      `INSERT INTO attachments (id, workspace_id, note_id, filename, mime, size_bytes, sha256, storage_key, width, height, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET filename = EXCLUDED.filename, mime = EXCLUDED.mime, size_bytes = EXCLUDED.size_bytes,
         sha256 = EXCLUDED.sha256, storage_key = EXCLUDED.storage_key, width = EXCLUDED.width, height = EXCLUDED.height`,
      [
        attachment.id, input.workspaceId, attachment.noteId, attachment.filename, attachment.mime, data.length,
        crypto.createHash('sha256').update(data).digest('hex'), storageKey, attachment.width, attachment.height,
        createdBy, attachment.createdAt,
      ],
    );
  }
  for (const old of oldAttachmentKeys) {
    if (!newStorageKeys.has(old.storage_key)) await deleteAttachment(old.storage_key).catch(() => {});
  }
  await updateJob(input.jobId, { progress: 96, message: '正在完成恢复…' });
  return {
    mode: 'replace',
    notes: document.notes.length,
    folders: document.folders.length,
    attachments: newStorageKeys.size,
    versions: document.versions.length,
    comments: document.comments.length,
  };
}

async function backupToParsedImport(input: {
  buffer: Buffer;
  jobDir: string;
  targetFolderId: string | null;
}): Promise<ParsedImport> {
  const { zip, document } = readBackupZip(input.buffer);
  const folderMap = new Map(document.folders.map((folder) => [folder.id, folder]));
  function folderPath(folderId: string | null): string[] {
    const parts: string[] = [];
    let current = folderId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const folder = folderMap.get(current);
      if (!folder) break;
      parts.unshift(folder.name);
      current = folder.parentId;
    }
    return parts;
  }
  const parsed: ParsedImport = { source: 'json', notes: [], warnings: [] };
  for (const note of document.notes) {
    const attachments: ParsedAttachment[] = [];
    let content = note.contentMd;
    for (const attachment of document.attachments.filter((item) => item.noteId === note.id)) {
      const entry = zip.getEntry(attachment.zipPath);
      if (!entry) continue;
      const key = crypto.randomUUID();
      const dir = path.join(input.jobDir, 'files');
      await fs.mkdir(dir, { recursive: true });
      const filename = safeFilename(attachment.filename);
      const storedPath = path.join(dir, `${key}-${filename}`);
      await fs.writeFile(storedPath, readEntryData(entry), { mode: 0o600 });
      attachments.push({
        key,
        filename,
        mime: attachment.mime,
        storedPath: path.relative(input.jobDir, storedPath),
      });
      content = content.replaceAll(`/api/attachments/${attachment.id}/content`, `360note-attachment://${key}`);
    }
    parsed.notes.push({
      title: note.title,
      contentMd: content,
      folderPath: ['恢复副本 ' + new Date().toISOString().slice(0, 10), ...folderPath(note.folderId)],
      tags: document.noteTags
        .filter((link) => link.noteId === note.id)
        .map((link) => document.tags.find((tag) => tag.id === link.tagId)?.name)
        .filter((name): name is string => Boolean(name)),
      attachments,
    });
  }
  parsed.warnings.push('合并恢复不会带回历史版本、评论和旧的分享链接。');
  return parsed;
}

export async function restoreBackup(input: {
  workspaceId: string;
  userId: string;
  buffer: Buffer;
  mode: 'replace' | 'merge';
  jobId: string;
}): Promise<Record<string, unknown>> {
  const document = previewBackup(input.buffer, input.workspaceId);
  if (input.mode === 'replace') {
    if (!document.sameWorkspace) throw errors.badRequest('只能替换恢复到备份来源的工作区');
    await requireWorkspace(input.userId, input.workspaceId, 'manage');
    await updateJob(input.jobId, { progress: 8, message: '正在创建恢复前安全备份…' });
    await createBackup({
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: 'pre-restore',
      jobId: input.jobId,
    });
    return restoreReplace(input);
  }
  if (input.mode === 'merge') {
    await requireWorkspace(input.userId, input.workspaceId, 'write');
    const jobDir = paths.imports + '/' + input.jobId;
    await fs.mkdir(jobDir, { recursive: true, mode: 0o700 });
    const parsed = await backupToParsedImport({ buffer: input.buffer, jobDir, targetFolderId: null });
    return executeImport({
      jobId: input.jobId,
      jobDir,
      userId: input.userId,
      workspaceId: input.workspaceId,
      parsed,
    });
  }
  throw errors.badRequest('未知的恢复方式');
}

export async function cleanupImportUploads(): Promise<void> {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  try {
    for (const dir of await fs.readdir(paths.imports)) {
      const full = path.join(paths.imports, dir);
      const stat = await fs.stat(full);
      if (stat.isDirectory() && stat.mtimeMs < cutoff) await fs.rm(full, { recursive: true, force: true });
    }
  } catch {
    /* no imports yet */
  }
}

export async function downloadBackupBuffer(filename: string): Promise<Buffer> {
  return readBackup(filename);
}

export async function deleteBackupRecord(id: string, workspaceId: string, userId: string): Promise<void> {
  await requireWorkspace(userId, workspaceId, 'manage');
  const row = await one<{ filename: string }>('SELECT filename FROM backups WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
  if (!row) throw errors.notFound('备份不存在');
  await one('DELETE FROM backups WHERE id = $1 RETURNING id', [id]);
  await deleteOffsiteBackup(row.filename).catch(() => {});
  await deleteBackupFile(row.filename).catch(() => {});
}

export async function backupRecord(id: string, workspaceId: string, userId: string): Promise<{ filename: string; workspace_id: string }> {
  await requireWorkspace(userId, workspaceId, 'read');
  const row = await one<{ filename: string; workspace_id: string }>(
    'SELECT filename, workspace_id FROM backups WHERE id = $1 AND workspace_id = $2',
    [id, workspaceId],
  );
  if (!row) throw errors.notFound('备份不存在');
  return row;
}

export async function runAutoBackups(): Promise<void> {
  const workspaces = await many<{ id: string; owner_id: string; name: string }>(
    'SELECT id, owner_id, name FROM workspaces WHERE deleted_at IS NULL',
  );
  for (const workspace of workspaces) {
    try {
      const existing = await one<{ id: string }>(
        `SELECT id FROM backups WHERE workspace_id = $1 AND kind = 'auto' AND created_at > now() - interval '20 hours' LIMIT 1`,
        [workspace.id],
      );
      if (existing) continue;
      await createBackup({ workspaceId: workspace.id, userId: workspace.owner_id, kind: 'auto' });
      console.log('[backup] auto backup created', workspace.name);
    } catch (error) {
      console.error('[backup] auto backup failed', workspace.id, error);
    }
  }
  void query;
  void audit;
}
