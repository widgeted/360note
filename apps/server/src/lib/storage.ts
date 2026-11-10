import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, paths } from '../config.js';
import { encryptBuffer, decryptBuffer } from './crypto.js';
import { attachmentObjectStorageKey, attachmentStorageKeyFromObject, deleteObject, getObject, getObjectStorageConfig, objectExists, objectStorageConfigured, putObject, attachmentStorageMigrationMode } from './object-storage.js';

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
  const config = await getObjectStorageConfig();
  const wantS3 = target === 's3' || (target === undefined && config.attachmentsEnabled && objectStorageConfigured(config) && !attachmentStorageMigrationMode());
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
  await fsp.writeFile(target, encrypted, { mode: 0o600 });
  return encrypted.length;
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
  const headers: Record<string, string> = {
    'Content-Type': mime || 'application/octet-stream',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(safeFilename(filename))}`,
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
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (provided && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(provided)) return provided;
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
