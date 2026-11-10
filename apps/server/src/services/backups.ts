import AdmZip from 'adm-zip';
import archiver from 'archiver';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
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
  saveBackupFromFile,
  readBackupToFile,
} from '../lib/storage.js';
import { updateJob } from '../lib/jobs.js';
import type { ParsedImport, ParsedNote, ParsedAttachment } from '../lib/import-parser.js';
import { executeImport } from './import.js';
import { requireWorkspace } from './workspaces.js';
import { audit } from '../lib/audit.js';
import { deleteOffsiteBackup, getOffsiteConfig, uploadOffsiteBackup } from './offsite.js';
import { withWorkspaceLock } from '../lib/workspace-lock.js';
import { getSetting } from './settings.js';

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
  trashedAt?: string | null;
}

interface BackupFolder {
  id: string;
  parentId: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  position: number;
  trashedAt?: string | null;
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

/** Trusted backups created by this instance. */
export const BACKUP_LIMITS = {
  maxEntries: 20_000,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 500,
} as const;

/** Uploaded archives are untrusted and keep the tighter envelope. */
export const UPLOAD_BACKUP_LIMITS = {
  maxEntries: 5_000,
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

function backupFilename(workspaceId: string, workspaceName: string, kind: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace('Z', '');
  return `${kind}-${workspaceId.slice(0, 8)}-${safeFilename(workspaceName).slice(0, 32)}-${stamp}.3nb`;
}

async function collectBackupDocument(workspaceId: string): Promise<{
  workspace: { id: string; name: string };
  document: BackupDocument;
  attachmentRows: Array<{
    id: string;
    note_id: string;
    filename: string;
    mime: string;
    size_bytes: string;
    width: number | null;
    height: number | null;
    storage_key: string;
    sha256: string;
    created_by: string;
    created_at: Date;
  }>;
}> {
  const workspace = await one<{ id: string; name: string }>('SELECT id, name FROM workspaces WHERE id = $1 AND deleted_at IS NULL', [workspaceId]);
  if (!workspace) throw errors.notFound('工作区不存在');
  const folders = await many<{
    id: string;
    parent_id: string | null;
    name: string;
    color: string | null;
    icon: string | null;
    position: number;
    trashed_at: Date | null;
  }>('SELECT id, parent_id, name, color, icon, position, trashed_at FROM folders WHERE workspace_id = $1 ORDER BY position, created_at', [workspaceId]);
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
    trashed_at: Date | null;
  }>(
    `SELECT id, title, content_md, folder_id, version, is_favorite, is_pinned, created_by, updated_by, created_at, updated_at, trashed_at
     FROM notes WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
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
        sha256: string;
        created_by: string;
        created_at: Date;
      }>(
        `SELECT id, note_id, filename, mime, size_bytes, width, height, storage_key, sha256, created_by, created_at
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
      trashedAt: folder.trashed_at?.toISOString() ?? null,
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
      trashedAt: note.trashed_at?.toISOString() ?? null,
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
      zipPath: `attachments/${attachment.sha256}.bin`,
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
  return { workspace, document, attachmentRows };
}

function backupManifest(document: BackupDocument): Buffer {
  return Buffer.from(JSON.stringify({
    format: '360note-backup',
    version: 1,
    createdAt: document.createdAt,
    workspace: document.workspace,
    counts: document.counts,
  }, null, 2));
}

/** In-memory variant used by account export and tests. */
export async function createBackupDocument(workspaceId: string): Promise<{ buffer: Buffer; document: BackupDocument; name: string }> {
  const { workspace, document, attachmentRows } = await collectBackupDocument(workspaceId);
  const zip = new AdmZip();
  zip.addFile('manifest.json', backupManifest(document));
  zip.addFile('workspace.json', Buffer.from(JSON.stringify(document, null, 2)));
  const addedPaths = new Set<string>();
  for (const attachment of attachmentRows) {
    const zipPath = `attachments/${attachment.sha256}.bin`;
    if (addedPaths.has(zipPath)) continue;
    try {
      const data = await readAttachment(attachment.storage_key);
      zip.addFile(zipPath, data);
      addedPaths.add(zipPath);
    } catch (error) {
      throw new Error(`附件读取失败，备份未生成：${attachment.filename} (${(error as Error).message.slice(0, 120)})`);
    }
  }
  for (const attachment of document.attachments) {
    if (!addedPaths.has(attachment.zipPath)) {
      throw new Error(`备份缺少附件内容：${attachment.filename}`);
    }
  }
  return { buffer: zip.toBuffer(), document, name: backupFilename(workspace.id, workspace.name, 'backup') };
}

/** Stream the archive to disk so large workspaces do not build the ZIP in RAM. */
export async function createBackupArchive(workspaceId: string, outputPath: string): Promise<{ document: BackupDocument; name: string }> {
  const { workspace, document, attachmentRows } = await collectBackupDocument(workspaceId);
  const output = fsSync.createWriteStream(outputPath, { mode: 0o600, flags: 'wx' });
  const archive = archiver('zip', { zlib: { level: 6 } });
  const finished = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  try {
    archive.append(backupManifest(document), { name: 'manifest.json' });
    archive.append(JSON.stringify(document, null, 2), { name: 'workspace.json' });
    const addedPaths = new Set<string>();
    for (const attachment of attachmentRows) {
      const zipPath = `attachments/${attachment.sha256}.bin`;
      if (addedPaths.has(zipPath)) continue;
      try {
        const data = await readAttachment(attachment.storage_key);
        archive.append(data, { name: zipPath });
        addedPaths.add(zipPath);
      } catch (error) {
        throw new Error(`附件读取失败，备份未生成：${attachment.filename} (${(error as Error).message.slice(0, 120)})`);
      }
    }
    for (const attachment of document.attachments) {
      if (!addedPaths.has(attachment.zipPath)) throw new Error(`备份缺少附件内容：${attachment.filename}`);
    }
    await archive.finalize();
    await finished;
  } catch (error) {
    archive.abort();
    output.destroy();
    await fs.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  }
  return { document, name: backupFilename(workspace.id, workspace.name, 'backup') };
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
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '360note-backup-'));
  const archivePath = path.join(tempDir, 'archive.zip');
  const verifyPath = path.join(tempDir, 'verify.zip');
  let name = '';
  let encryptedSize = 0;
  let document: BackupDocument | null = null;
  try {
    if (input.jobId) await updateJob(input.jobId, { progress: 12, message: '正在打包工作区…' });
    const archive = await createBackupArchive(input.workspaceId, archivePath);
    name = archive.name;
    document = archive.document;
    if (input.jobId) await updateJob(input.jobId, { progress: 58, message: '正在加密备份…' });
    encryptedSize = await saveBackupFromFile(name, archivePath);
    if (input.jobId) await updateJob(input.jobId, { progress: 70, message: '正在校验备份…' });
    // Verify decryption and ZIP structure before publishing the backup row.
    await readBackupToFile(name, verifyPath);
    const preview = previewBackupFile(verifyPath, input.workspaceId, BACKUP_LIMITS);
    if (
      preview.counts.notes !== archive.document.counts.notes ||
      preview.counts.attachments !== archive.document.counts.attachments ||
      preview.workspace.id !== input.workspaceId
    ) {
      throw new Error('备份校验失败：内容与清单不一致');
    }
  } catch (error) {
    if (name) await deleteBackupFile(name).catch(() => {});
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
  const archived = document!;
  const row = await one<{ id: string; created_at: Date }>(
    `INSERT INTO backups (workspace_id, filename, storage_key, size_bytes, kind, status, note_count, attachment_count, meta, created_by, job_id)
     VALUES ($1, $2, $3, $4, $5, 'ready', $6, $7, $8, $9, $10) RETURNING id, created_at`,
    [
      input.workspaceId,
      name,
      backupStorageKey(name),
      encryptedSize,
      input.kind,
      archived.counts.notes,
      archived.counts.attachments,
      JSON.stringify({ createdAt: archived.createdAt, folderCount: archived.counts.folders, tagCount: archived.counts.tags }),
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
  const backupSettings = await getSetting<{ retentionDays?: number }>('backup');
  const retentionDays = Math.max(1, Number(backupSettings?.retentionDays) || config.backupRetentionDays);
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
    if (Date.now() - row.created_at.getTime() > retentionDays * 24 * 60 * 60 * 1000) {
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

function inspectBackupZip(zip: AdmZip, limits: typeof BACKUP_LIMITS | typeof UPLOAD_BACKUP_LIMITS = UPLOAD_BACKUP_LIMITS): void {
  let entries: AdmZip.IZipEntry[];
  try {
    entries = zip.getEntries();
  } catch {
    throw errors.badRequest('备份文件已损坏');
  }
  if (entries.length > limits.maxEntries) {
    throw errors.badRequest('备份文件包含过多条目');
  }
  let total = 0;
  for (const entry of entries) {
    const size = entry.header.size;
    const compressed = entry.header.compressedSize;
    if (!Number.isFinite(size) || size < 0 || !Number.isFinite(compressed) || compressed < 0) {
      throw errors.badRequest('备份文件已损坏');
    }
    if (size > limits.maxEntryBytes) {
      throw errors.badRequest('备份文件中的单个文件过大');
    }
    total += size;
    if (total > limits.maxTotalBytes) {
      throw errors.badRequest('备份文件解压后过大');
    }
    if (size > 1024 * 1024 && (compressed === 0 || size / compressed > limits.maxCompressionRatio)) {
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

function readBackupZip(buffer: Buffer, limits: typeof BACKUP_LIMITS | typeof UPLOAD_BACKUP_LIMITS = UPLOAD_BACKUP_LIMITS): { zip: AdmZip; manifest: Record<string, unknown>; document: BackupDocument } {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw errors.badRequest('备份文件已损坏');
  }
  inspectBackupZip(zip, limits);
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

export function inspectBackupBuffer(buffer: Buffer): {
  workspaceId: string;
  workspaceName: string;
  counts: BackupDocument['counts'];
  createdAt: string;
} {
  const { document } = readBackupZip(buffer);
  return {
    workspaceId: document.workspace.id,
    workspaceName: document.workspace.name,
    counts: document.counts,
    createdAt: document.createdAt,
  };
}

function previewFromDocument(document: BackupDocument, targetWorkspaceId: string): BackupPreview {
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

export function previewBackup(buffer: Buffer, targetWorkspaceId: string, limits: typeof BACKUP_LIMITS | typeof UPLOAD_BACKUP_LIMITS = UPLOAD_BACKUP_LIMITS): BackupPreview {
  return previewFromDocument(readBackupZip(buffer, limits).document, targetWorkspaceId);
}

function readBackupZipFromFile(filePath: string, limits: typeof BACKUP_LIMITS | typeof UPLOAD_BACKUP_LIMITS = UPLOAD_BACKUP_LIMITS): { zip: AdmZip; document: BackupDocument } {
  let zip: AdmZip;
  try {
    zip = new AdmZip(filePath);
  } catch {
    throw errors.badRequest('备份文件已损坏');
  }
  inspectBackupZip(zip, limits);
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
  return { zip, document };
}

export function previewBackupFile(filePath: string, targetWorkspaceId: string, limits: typeof BACKUP_LIMITS | typeof UPLOAD_BACKUP_LIMITS = UPLOAD_BACKUP_LIMITS): BackupPreview {
  return previewFromDocument(readBackupZipFromFile(filePath, limits).document, targetWorkspaceId);
}

function validateBackupRestore(document: BackupDocument): void {
  const folderIds = new Set(document.folders.map((folder) => folder.id));
  const noteIds = new Set(document.notes.map((note) => note.id));
  const tagIds = new Set(document.tags.map((tag) => tag.id));
  const tagNames = new Set<string>();
  if (folderIds.size !== document.folders.length) throw errors.badRequest('备份包含重复的文件夹 ID');
  if (noteIds.size !== document.notes.length) throw errors.badRequest('备份包含重复的笔记 ID');
  if (tagIds.size !== document.tags.length) throw errors.badRequest('备份包含重复的标签 ID');
  for (const tag of document.tags) {
    const key = tag.name.trim().toLowerCase();
    if (tagNames.has(key)) throw errors.badRequest('备份包含重名标签');
    tagNames.add(key);
  }
  const folderParents = new Map(document.folders.map((folder) => [folder.id, folder.parentId]));
  for (const folder of document.folders) {
    if (folder.parentId === folder.id) throw errors.badRequest('备份包含循环文件夹');
    if (folder.parentId && !folderIds.has(folder.parentId)) throw errors.badRequest('备份文件夹父级不属于同一工作区');
    const seen = new Set<string>();
    let current: string | null = folder.id;
    while (current) {
      if (seen.has(current)) throw errors.badRequest('备份包含循环文件夹');
      seen.add(current);
      current = folderParents.get(current) ?? null;
    }
  }
  for (const note of document.notes) {
    if (note.folderId && !folderIds.has(note.folderId)) throw errors.badRequest('备份笔记的文件夹不属于同一工作区');
  }
  for (const link of document.noteTags) {
    if (!noteIds.has(link.noteId) || !tagIds.has(link.tagId)) throw errors.badRequest('备份标签关联无效');
  }
  for (const attachment of document.attachments) {
    if (!noteIds.has(attachment.noteId)) throw errors.badRequest('备份附件关联了其他工作区的笔记');
  }
  for (const version of document.versions) {
    if (!noteIds.has(version.noteId)) throw errors.badRequest('备份版本关联了其他工作区的笔记');
  }
  for (const comment of document.comments) {
    if (!noteIds.has(comment.noteId)) throw errors.badRequest('备份评论关联了其他工作区的笔记');
  }
}

async function assertNoForeignIds(document: BackupDocument, workspaceId: string): Promise<void> {
  const checks: Array<{ table: string; ids: string[] }> = [
    { table: 'notes', ids: document.notes.map((note) => note.id) },
    { table: 'folders', ids: document.folders.map((folder) => folder.id) },
    { table: 'tags', ids: document.tags.map((tag) => tag.id) },
    { table: 'attachments', ids: document.attachments.map((attachment) => attachment.id) },
  ];
  for (const check of checks) {
    if (!check.ids.length) continue;
    const rows = await many<{ id: string }>(
      `SELECT id FROM ${check.table} WHERE id = ANY($1::uuid[]) AND workspace_id <> $2 LIMIT 1`,
      [check.ids, workspaceId],
    );
    if (rows.length) throw errors.badRequest(`备份包含其他工作区的 ${check.table} ID`);
  }
}

async function restoreReplace(input: {
  workspaceId: string;
  userId: string;
  buffer?: Buffer;
  filePath?: string;
  jobId: string;
  limits?: typeof BACKUP_LIMITS | typeof UPLOAD_BACKUP_LIMITS;
}): Promise<Record<string, unknown>> {
  if (!input.buffer && !input.filePath) throw errors.badRequest('缺少备份文件');
  const { zip, document } = input.filePath
    ? readBackupZipFromFile(input.filePath, input.limits)
    : readBackupZip(input.buffer!, input.limits);
  await requireWorkspace(input.userId, input.workspaceId, 'manage');
  if (document.workspace.id !== input.workspaceId) throw errors.badRequest('只能替换恢复到备份来源的工作区');
  validateBackupRestore(document);
  await assertNoForeignIds(document, input.workspaceId);

  const memberRows = await many<{ user_id: string }>(
    'SELECT user_id FROM workspace_members WHERE workspace_id = $1',
    [input.workspaceId],
  );
  const memberIds = new Set(memberRows.map((row) => row.user_id));
  memberIds.add(input.userId);

  const oldAttachmentKeys = await many<{ storage_key: string }>(
    'SELECT storage_key FROM attachments WHERE workspace_id = $1',
    [input.workspaceId],
  );
  const preparedAttachments: Array<{
    attachment: BackupAttachment;
    storageKey: string;
    sha256: string;
    size: number;
  }> = [];

  try {
    for (const attachment of document.attachments) {
      const entry = zip.getEntry(attachment.zipPath);
      if (!entry) throw errors.badRequest(`备份缺少附件：${attachment.filename}`);
      const data = readEntryData(entry);
      const localKey = attachmentStorageKey(input.workspaceId, attachment.id);
      const storageKey = await saveAttachment(localKey, data);
      preparedAttachments.push({
        attachment,
        storageKey,
        sha256: crypto.createHash('sha256').update(data).digest('hex'),
        size: data.length,
      });
    }
  } catch (error) {
    await Promise.all(preparedAttachments.map((item) => deleteAttachment(item.storageKey).catch(() => {})));
    throw error;
  }

  const newStorageKeys = new Set(preparedAttachments.map((item) => item.storageKey));
  let shareRows: Array<Record<string, unknown>> = [];
  try {
    await transaction(async (client) => {
      const shares = await client.query<Record<string, unknown>>(
        `SELECT * FROM share_links WHERE note_id IN (SELECT id FROM notes WHERE workspace_id = $1)`,
        [input.workspaceId],
      );
      shareRows = shares.rows;

      await client.query('DELETE FROM notes WHERE workspace_id = $1', [input.workspaceId]);
      await client.query('DELETE FROM folders WHERE workspace_id = $1', [input.workspaceId]);
      await client.query('DELETE FROM tags WHERE workspace_id = $1', [input.workspaceId]);

      for (const folder of document.folders) {
        await client.query(
          `INSERT INTO folders (id, workspace_id, parent_id, name, color, icon, position, trashed_at, created_at, updated_at)
           VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $8)`,
          [folder.id, input.workspaceId, folder.name, folder.color, folder.icon, folder.position, folder.trashedAt ?? null, document.createdAt],
        );
      }
      for (const folder of document.folders) {
        if (!folder.parentId) continue;
        await client.query('UPDATE folders SET parent_id = $2 WHERE id = $1 AND workspace_id = $3', [
          folder.id,
          folder.parentId,
          input.workspaceId,
        ]);
      }
      for (const tag of document.tags) {
        await client.query(
          'INSERT INTO tags (id, workspace_id, name, color, created_at) VALUES ($1, $2, $3, $4, $5)',
          [tag.id, input.workspaceId, tag.name, tag.color, document.createdAt],
        );
      }
      for (const note of document.notes) {
        await client.query(
          `INSERT INTO notes (id, workspace_id, folder_id, title, content_md, excerpt, version, is_favorite, is_pinned,
             created_by, updated_by, created_at, updated_at, trashed_at, encrypted)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false)`,
          [
            note.id, input.workspaceId, note.folderId, note.title, note.contentMd, excerpt(note.contentMd), note.version,
            note.isFavorite, note.isPinned,
            memberIds.has(note.createdBy) ? note.createdBy : input.userId,
            memberIds.has(note.updatedBy) ? note.updatedBy : input.userId,
            note.createdAt, note.updatedAt, note.trashedAt ?? null,
          ],
        );
      }
      for (const link of document.noteTags) {
        await client.query('INSERT INTO note_tags (note_id, tag_id) VALUES ($1, $2)', [link.noteId, link.tagId]);
      }
      for (const version of document.versions) {
        await client.query(
          `INSERT INTO note_versions (note_id, version, title, content_md, reason, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            version.noteId, version.version, version.title, version.contentMd, version.reason,
            version.createdBy && memberIds.has(version.createdBy) ? version.createdBy : null, version.createdAt,
          ],
        );
      }
      for (const comment of document.comments) {
        await client.query(
          `INSERT INTO comments (note_id, guest_name, user_id, body, resolved, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            comment.noteId, comment.guestName,
            comment.userId && memberIds.has(comment.userId) ? comment.userId : null,
            comment.body, comment.resolved, comment.createdAt, comment.updatedAt,
          ],
        );
      }
      for (const note of document.notes) {
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
      for (const item of preparedAttachments) {
        const attachment = item.attachment;
        await client.query(
          `INSERT INTO attachments (id, workspace_id, note_id, filename, mime, size_bytes, sha256, storage_key, width, height, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            attachment.id, input.workspaceId, attachment.noteId, attachment.filename, attachment.mime, item.size,
            item.sha256, item.storageKey, attachment.width, attachment.height,
            memberIds.has(attachment.createdBy) ? attachment.createdBy : input.userId, attachment.createdAt,
          ],
        );
      }
      for (const share of shareRows) {
        await client.query(
          `INSERT INTO share_links (id, note_id, token_hash, token_cipher, permission, password_hash, expires_at,
             created_by, created_at, revoked_at, view_count, last_accessed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            share.id, share.note_id, share.token_hash, share.token_cipher, share.permission, share.password_hash,
            share.expires_at, share.created_by, share.created_at, share.revoked_at, share.view_count, share.last_accessed_at,
          ],
        );
      }
      await client.query('UPDATE workspaces SET updated_at = now() WHERE id = $1', [input.workspaceId]);
    });
  } catch (error) {
    await Promise.all(preparedAttachments.map((item) => deleteAttachment(item.storageKey).catch(() => {})));
    throw error;
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
  buffer?: Buffer;
  filePath?: string;
  jobDir: string;
  targetFolderId: string | null;
  limits?: typeof BACKUP_LIMITS | typeof UPLOAD_BACKUP_LIMITS;
}): Promise<ParsedImport> {
  if (!input.buffer && !input.filePath) throw errors.badRequest('缺少备份文件');
  const { zip, document } = input.filePath
    ? readBackupZipFromFile(input.filePath, input.limits)
    : readBackupZip(input.buffer!, input.limits);
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
  for (const note of document.notes.filter((item) => !item.trashedAt)) {
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
  parsed.warnings.push('合并恢复不会带回回收站内容、历史版本、评论和旧的分享链接。');
  return parsed;
}

export async function restoreBackup(input: {
  workspaceId: string;
  userId: string;
  buffer?: Buffer;
  filePath?: string;
  mode: 'replace' | 'merge';
  jobId: string;
  limits?: typeof BACKUP_LIMITS | typeof UPLOAD_BACKUP_LIMITS;
}): Promise<Record<string, unknown>> {
  if (!input.buffer && !input.filePath) throw errors.badRequest('缺少备份文件');
  return withWorkspaceLock(input.workspaceId, async () => {
    const document = input.filePath
      ? previewBackupFile(input.filePath, input.workspaceId, input.limits)
      : previewBackup(input.buffer!, input.workspaceId, input.limits);
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
      return restoreReplace({ ...input, limits: input.limits });
    }
    if (input.mode === 'merge') {
      await requireWorkspace(input.userId, input.workspaceId, 'write');
      const jobDir = paths.imports + '/' + input.jobId;
      await fs.mkdir(jobDir, { recursive: true, mode: 0o700 });
      const parsed = await backupToParsedImport({ buffer: input.buffer, filePath: input.filePath, jobDir, targetFolderId: null, limits: input.limits });
      return executeImport({
        jobId: input.jobId,
        jobDir,
        userId: input.userId,
        workspaceId: input.workspaceId,
        parsed,
      });
    }
    throw errors.badRequest('未知的恢复方式');
  });
}

export async function cleanupImportUploads(): Promise<void> {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  try {
    for (const entry of await fs.readdir(paths.imports, { withFileTypes: true })) {
      const full = path.join(paths.imports, entry.name);
      const stat = await fs.stat(full);
      if (stat.mtimeMs >= cutoff) continue;
      if (entry.isDirectory()) {
        await fs.rm(full, { recursive: true, force: true });
      } else if (entry.isFile() && (entry.name.startsWith('upload-') || entry.name.endsWith('.3nb') || entry.name.endsWith('.nhbackup'))) {
        await fs.rm(full, { force: true });
      }
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
