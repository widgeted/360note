import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, paths } from '../config.js';
import { encryptBuffer, decryptBuffer, encryptFile, decryptFile } from './crypto.js';
import { attachmentObjectStorageKey, attachmentStorageKeyFromObject, deleteObject, getObject, getObjectStorageConfig, objectExists, objectStorageConfigured, putObject, putObjectStream, attachmentStorageMigrationMode } from './object-storage.js';

const ATTACHMENT_AAD = '360note:attachment';
const BACKUP_AAD = '360note:backup';

export function safeFilename(name: string): string {
  const base = path.basename(name || 'file').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_');
  const trimmed = base.trim().slice(0, 180);
  return trimmed || 'file';
}

function assertInside(base: string, target: string): void {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(target);
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error('Path escapes storage root');
  }
}

export function attachmentStorageKey(workspaceId: string, attachmentId: string): string {
  return path.posix.join(workspaceId, `${attachmentId}.nh`);
}

export function attachmentThumbnailStorageKey(storageKey: string): string {
  return storageKey.endsWith('.nh') ? `${storageKey.slice(0, -3)}.thumb.nh` : `${storageKey}.thumb`;
}

export async function saveAttachment(
  storageKey: string,
  data: Buffer,
  target?: 'local' | 's3',
): Promise<string> {
  let config: Awaited<ReturnType<typeof getObjectStorageConfig>> | null = null;
  try {
    config = await getObjectStorageConfig();
  } catch (error) {
    // A broken offsite secret must never stop local attachments from working.
    console.warn('[storage] object storage config unavailable', (error as Error).message);
  }
  const wantS3 = target === 's3' || (target === undefined && config?.attachmentsEnabled === true && objectStorageConfigured(config) && !attachmentStorageMigrationMode());
  const effectiveKey = storageKey.startsWith('s3:') || !wantS3 ? storageKey : attachmentObjectStorageKey(storageKey);
  const encrypted = encryptBuffer(data, ATTACHMENT_AAD);
  if (effectiveKey.startsWith('s3:')) {
    await putObject(effectiveKey, encrypted);
    return effectiveKey;
  }
  const localTarget = path.join(paths.attachments, effectiveKey);
  assertInside(paths.attachments, localTarget);
  await fsp.mkdir(path.dirname(localTarget), { recursive: true, mode: 0o700 });
  await fsp.writeFile(localTarget, encrypted, { mode: 0o600 });
  return effectiveKey;
}

/**
 * Encrypt an on-disk upload into the attachment store. Used by backup restore
 * so a single large attachment never has to be buffered in process memory.
 */
export async function saveAttachmentFromFile(
  storageKey: string,
  sourcePath: string,
  target?: 'local' | 's3',
): Promise<string> {
  let config: Awaited<ReturnType<typeof getObjectStorageConfig>> | null = null;
  try {
    config = await getObjectStorageConfig();
  } catch (error) {
    console.warn('[storage] object storage config unavailable', (error as Error).message);
  }
  const wantS3 = target === 's3' || (target === undefined && config?.attachmentsEnabled === true && objectStorageConfigured(config) && !attachmentStorageMigrationMode());
  const effectiveKey = storageKey.startsWith('s3:') || !wantS3 ? storageKey : attachmentObjectStorageKey(storageKey);
  if (effectiveKey.startsWith('s3:')) {
    const temp = path.join(paths.temp, `attach-${crypto.randomUUID()}.enc`);
    try {
      const size = await encryptFile(sourcePath, temp, ATTACHMENT_AAD);
      await putObjectStream(effectiveKey, fs.createReadStream(temp), size);
      return effectiveKey;
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  }
  const localTarget = path.join(paths.attachments, effectiveKey);
  assertInside(paths.attachments, localTarget);
  await fsp.mkdir(path.dirname(localTarget), { recursive: true, mode: 0o700 });
  await encryptFile(sourcePath, localTarget, ATTACHMENT_AAD);
  return effectiveKey;
}

export async function readAttachment(storageKey: string): Promise<Buffer> {
  if (storageKey.startsWith('s3:')) {
    return decryptBuffer(await getObject(storageKey), ATTACHMENT_AAD);
  }
  const target = path.join(paths.attachments, storageKey);
  assertInside(paths.attachments, target);
  return decryptBuffer(await fsp.readFile(target), ATTACHMENT_AAD);
}

async function removeLocalAttachmentFiles(storageKey: string): Promise<void> {
  if (storageKey.startsWith('s3:')) return;
  const target = path.join(paths.attachments, storageKey);
  const thumb = path.join(paths.attachments, attachmentThumbnailStorageKey(storageKey));
  assertInside(paths.attachments, target);
  assertInside(paths.attachments, thumb);
  await Promise.all([
    fsp.rm(target, { force: true }),
    fsp.rm(thumb, { force: true }),
  ]);
}

export async function deleteAttachment(storageKey: string): Promise<void> {
  const localKey = storageKey.startsWith('s3:') ? attachmentStorageKeyFromObject(storageKey) : storageKey;
  const remoteKey = storageKey.startsWith('s3:') ? storageKey : attachmentObjectStorageKey(storageKey);
  await Promise.all([
    removeLocalAttachmentFiles(localKey),
    deleteObject(remoteKey).catch(() => {}),
    deleteObject(attachmentThumbnailStorageKey(remoteKey)).catch(() => {}),
  ]);
}

export async function attachmentExists(storageKey: string): Promise<boolean> {
  if (storageKey.startsWith('s3:')) return objectExists(storageKey);
  try {
    await fsp.access(path.join(paths.attachments, storageKey));
    return true;
  } catch {
    return false;
  }
}

export function backupStorageKey(filename: string): string {
  return safeFilename(filename);
}

export async function saveBackup(filename: string, data: Buffer): Promise<number> {
  const target = path.join(paths.backups, backupStorageKey(filename));
  assertInside(paths.backups, target);
  const encrypted = encryptBuffer(data, BACKUP_AAD);
  await fsp.writeFile(target, encrypted, { mode: 0o600, flag: 'wx' });
  return encrypted.length;
}

/** Encrypt an on-disk archive into the backup store without buffering it. */
export async function saveBackupFromFile(filename: string, sourcePath: string): Promise<number> {
  const target = path.join(paths.backups, backupStorageKey(filename));
  assertInside(paths.backups, target);
  const temp = `${target}.tmp-${crypto.randomUUID()}`;
  try {
    const size = await encryptFile(sourcePath, temp, BACKUP_AAD);
    // link() is exclusive: a colliding backup name must fail instead of
    // overwriting another workspace's archive.
    await fsp.link(temp, target);
    await fsp.rm(temp, { force: true });
    return size;
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** Decrypt a stored backup into a temporary file for preview/restore. */
export async function readBackupToFile(filename: string, outputPath: string): Promise<void> {
  const target = path.join(paths.backups, backupStorageKey(filename));
  assertInside(paths.backups, target);
  await decryptFile(target, outputPath, BACKUP_AAD);
}

export async function readBackup(filename: string): Promise<Buffer> {
  const target = path.join(paths.backups, backupStorageKey(filename));
  assertInside(paths.backups, target);
  return decryptBuffer(await fsp.readFile(target), BACKUP_AAD);
}

export async function deleteBackupFile(filename: string): Promise<void> {
  const target = path.join(paths.backups, backupStorageKey(filename));
  assertInside(paths.backups, target);
  await fsp.rm(target, { force: true });
}

export async function backupFileSize(filename: string): Promise<number> {
  const stat = await fsp.stat(path.join(paths.backups, backupStorageKey(filename)));
  return stat.size;
}

export function tempJobDir(jobId: string): string {
  const target = path.join(paths.imports, jobId);
  assertInside(paths.imports, target);
  return target;
}

export async function resetJobDir(jobId: string): Promise<string> {
  const dir = tempJobDir(jobId);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export async function saveTempUpload(jobId: string, filename: string, data: Buffer): Promise<string> {
  const dir = await resetJobDir(jobId);
  const target = path.join(dir, safeFilename(filename));
  assertInside(dir, target);
  await fsp.writeFile(target, data, { mode: 0o600 });
  return target;
}

export async function cleanupJobDir(jobId: string): Promise<void> {
  await fsp.rm(tempJobDir(jobId), { recursive: true, force: true });
}

export function sendFileHeaders(
  filename: string,
  mime: string,
  etag?: string,
): Record<string, string> {
  const active = /html|svg|xml|javascript|application\/octet-stream/i.test(mime || '');
  const headers: Record<string, string> = {
    'Content-Type': mime || 'application/octet-stream',
    'Content-Disposition': `${active ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(safeFilename(filename))}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=300',
  };
  if (etag) headers.ETag = `"${etag}"`;
  return headers;
}

export function isDisplayableImage(mime: string): boolean {
  return /^image\/(png|jpeg|gif|webp|avif)$/.test(mime);
}

export function sniffMime(buffer: Buffer, filename: string, provided?: string): string {
  const head = buffer.subarray(0, 16);
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (head.subarray(0, 3).toString() === 'GIF') return 'image/gif';
  if (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (head.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  if (head.subarray(0, 2).toString() === 'PK') return 'application/zip';
  if (head.subarray(0, 5).toString() === '%!PS-') return 'application/postscript';
  const lower = filename.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (/\.(dng|cr2|cr3|nef|arw|raf|orf|rw2|pef|srw)$/.test(lower)) return 'image/x-raw';
  if (/\.(mp4|m4v)$/.test(lower)) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (provided && /^(application\/(pdf|json|zip|msword|vnd\.)|text\/(plain|csv|markdown)|image\/(heic|heif|tiff|bmp|svg\+xml|x-raw)|video\/(mp4|webm|quicktime))[a-z0-9.+-]*$/i.test(provided)) return provided;
  return 'application/octet-stream';
}

export function checksum(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function ensureWritable(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  await fsp.access(dir, fs.constants.W_OK);
}

export function publicAttachmentUrl(workspaceId: string, attachmentId: string): string {
  return `${config.publicOrigin}/api/attachments/${attachmentId}/content`;
}
