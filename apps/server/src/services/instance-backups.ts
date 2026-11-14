import AdmZip from 'adm-zip';
import { createZipArchive } from '../lib/zip-archive.js';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import { config, paths } from '../config.js';
import { many, one, query } from '../db.js';
import { attachmentThumbnailStorageKey, deleteBackupFile, readBackup, safeFilename, saveBackupFromFile } from '../lib/storage.js';
import { attachmentStorageKeyFromObject, getObject } from '../lib/object-storage.js';
import { getSetting, setSetting } from './settings.js';
import { deleteOffsiteBackup, uploadOffsiteBackup } from './offsite.js';
import { decryptBuffer } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';

const exec = promisify(execFile);

export interface InstanceBackupSettings {
  enabled: boolean;
  frequencyHours: number;
  retentionCount: number;
  drillEnabled: boolean;
  drillFrequencyHours: number;
  lastDrillAt: string | null;
  lastDrillOk: boolean | null;
  lastDrillError: string | null;
  lastDrillBackup: string | null;
}

export async function getInstanceBackupSettings(): Promise<InstanceBackupSettings> {
  const value = await getSetting<Partial<InstanceBackupSettings>>('instanceBackup');
  return {
    enabled: value?.enabled === true,
    frequencyHours: Math.max(1, Number(value?.frequencyHours) || 24),
    retentionCount: Math.max(1, Number(value?.retentionCount) || 7),
    drillEnabled: value?.drillEnabled !== false,
    drillFrequencyHours: Math.max(1, Number(value?.drillFrequencyHours) || 24),
    lastDrillAt: typeof value?.lastDrillAt === 'string' ? value.lastDrillAt : null,
    lastDrillOk: typeof value?.lastDrillOk === 'boolean' ? value.lastDrillOk : null,
    lastDrillError: typeof value?.lastDrillError === 'string' ? value.lastDrillError : null,
    lastDrillBackup: typeof value?.lastDrillBackup === 'string' ? value.lastDrillBackup : null,
  };
}

export async function saveInstanceBackupSettings(patch: Partial<InstanceBackupSettings>): Promise<InstanceBackupSettings> {
  const current = await getInstanceBackupSettings();
  const next = {
    enabled: patch.enabled ?? current.enabled,
    frequencyHours: Math.max(1, Math.min(24 * 30, Math.round(patch.frequencyHours ?? current.frequencyHours))),
    retentionCount: Math.max(1, Math.min(365, Math.round(patch.retentionCount ?? current.retentionCount))),
    drillEnabled: patch.drillEnabled ?? current.drillEnabled,
    drillFrequencyHours: Math.max(1, Math.min(24 * 30, Math.round(patch.drillFrequencyHours ?? current.drillFrequencyHours))),
    lastDrillAt: current.lastDrillAt,
    lastDrillOk: current.lastDrillOk,
    lastDrillError: current.lastDrillError,
    lastDrillBackup: current.lastDrillBackup,
  };
  await setSetting('instanceBackup', next);
  return next;
}

async function databaseDump(target: string): Promise<void> {
  const url = new URL(config.databaseUrl);
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
  await exec(
    'pg_dump',
    [
      '-h', url.hostname,
      '-p', url.port || '5432',
      '-U', decodeURIComponent(url.username),
      '-d', decodeURIComponent(url.pathname.replace(/^\//, '')),
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--file', target,
    ],
    { env, timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024 },
  );
}

export async function createInstanceBackup(userId: string): Promise<{ id: string; filename: string; size: number }> {
  const jobId = crypto.randomUUID();
  const tempDir = path.join(paths.temp, `instance-backup-${jobId}`);
  const dumpPath = path.join(tempDir, 'database.dump');
  await fs.mkdir(tempDir, { recursive: true, mode: 0o700 });
  try {
    await databaseDump(dumpPath);
    // Object-storage-only attachments are not on disk. Copy the local
    // encrypted files, then overlay every remote object so the archive is a
    // complete instance snapshot regardless of where each attachment lives.
    const attachmentDir = path.join(tempDir, 'attachments');
    await fs.cp(paths.attachments, attachmentDir, { recursive: true, force: true }).catch(() => {});
    const remoteRows = await many<{ storage_key: string }>(
      `SELECT storage_key FROM attachments WHERE deleted_at IS NULL AND storage_key LIKE 's3:%'`,
    );
    for (const row of remoteRows) {
      const relative = attachmentStorageKeyFromObject(row.storage_key);
      const originalTarget = path.join(attachmentDir, relative);
      await fs.mkdir(path.dirname(originalTarget), { recursive: true, mode: 0o700 });
      await fs.writeFile(originalTarget, await getObject(row.storage_key), { mode: 0o600 });
      try {
        const thumbObject = attachmentThumbnailStorageKey(row.storage_key);
        const thumbTarget = path.join(attachmentDir, attachmentThumbnailStorageKey(relative));
        await fs.mkdir(path.dirname(thumbTarget), { recursive: true, mode: 0o700 });
        await fs.writeFile(thumbTarget, await getObject(thumbObject), { mode: 0o600 });
      } catch {
        /* Thumbnails can be regenerated; a missing one must not block disaster recovery. */
      }
    }
    const archivePath = path.join(tempDir, 'archive.zip');
    const output = fsSync.createWriteStream(archivePath, { mode: 0o600, flags: 'wx' });
    const archive = createZipArchive();
    const finished = new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
    });
    archive.pipe(output);
    archive.append(JSON.stringify({
      format: '360note-instance-backup',
      version: 2,
      appVersion: config.version,
      createdAt: new Date().toISOString(),
      note: 'database.dump is pg_dump custom format; attachments/ contains AES-256-GCM encrypted attachment files from the instance data directory.',
    }, null, 2), { name: 'manifest.json' });
    archive.file(dumpPath, { name: 'database.dump' });
    const hasAttachments = await fs.access(attachmentDir).then(() => true).catch(() => false);
    if (hasAttachments) archive.directory(attachmentDir, 'attachments');
    await archive.finalize();
    await finished;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const filename = `instance-${safeFilename(config.publicOrigin.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]/gi, '_'))}-${stamp}-${crypto.randomUUID().slice(0, 8)}.3nb`;
    const size = await saveBackupFromFile(filename, archivePath);
    const row = await one<{ id: string }>(
      `INSERT INTO instance_backups (filename, storage_key, size_bytes, status, created_by)
       VALUES ($1, $2, $3, 'ready', $4) RETURNING id`,
      [filename, filename, size, userId],
    );
    await uploadInstanceBackupToOffsite(row!.id);
    await pruneInstanceBackups(await getInstanceBackupSettings());
    return { id: row!.id, filename, size };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function uploadInstanceBackupToOffsite(id: string): Promise<'uploaded' | 'skipped' | 'failed'> {
  const row = await one<{ filename: string }>('SELECT filename FROM instance_backups WHERE id = $1', [id]);
  if (!row) return 'failed';
  const result = await uploadOffsiteBackup(row.filename);
  const status = result === 'uploaded' ? 'uploaded' : result === 'disabled' ? 'skipped' : 'failed';
  const stored = await getSetting<{ lastError?: string | null }>('offsite');
  const error = status === 'failed' ? stored?.lastError ?? '对象存储上传失败' : null;
  await query('UPDATE instance_backups SET offsite_status = $2, offsite_error = $3 WHERE id = $1', [
    id,
    status,
    error,
  ]);
  return status;
}

export async function pruneInstanceBackups(settings: InstanceBackupSettings): Promise<void> {
  const rows = await many<{ id: string; filename: string }>(
    'SELECT id, filename FROM instance_backups ORDER BY created_at DESC',
  );
  for (const row of rows.slice(settings.retentionCount)) {
    await deleteBackupFile(row.filename).catch(() => {});
    await deleteOffsiteBackup(row.filename).catch(() => {});
    await query('DELETE FROM instance_backups WHERE id = $1', [row.id]);
  }
}

export async function listInstanceBackups() {
  return many<{
    id: string;
    filename: string;
    size_bytes: string;
    status: string;
    offsite_status: string;
    offsite_error: string | null;
    created_at: Date;
  }>('SELECT id, filename, size_bytes, status, offsite_status, offsite_error, created_at FROM instance_backups ORDER BY created_at DESC');
}

export async function downloadInstanceBackup(filename: string): Promise<Buffer> {
  return readBackup(filename);
}

export async function deleteInstanceBackup(id: string): Promise<void> {
  const row = await one<{ filename: string }>('SELECT filename FROM instance_backups WHERE id = $1', [id]);
  if (!row) return;
  await deleteBackupFile(row.filename).catch(() => {});
  await deleteOffsiteBackup(row.filename).catch(() => {});
  await query('DELETE FROM instance_backups WHERE id = $1', [id]);
}

export async function runInstanceRestoreDrill(actorId?: string | null): Promise<{ ok: boolean; backup: string | null; error: string | null }> {
  const settings = await getInstanceBackupSettings();
  const latest = await one<{ filename: string }>('SELECT filename FROM instance_backups ORDER BY created_at DESC LIMIT 1');
  if (!latest) {
    return { ok: false, backup: null, error: '没有可演练的整站备份' };
  }
  try {
    const buffer = await readBackup(latest.filename);
    const zip = new AdmZip(buffer);
    const manifest = zip.getEntry('manifest.json');
    const dump = zip.getEntry('database.dump');
    if (!manifest || !dump) throw new Error('整站备份缺少 manifest 或 database.dump');
    const dumpData = dump.getData();
    if (dumpData.subarray(0, 5).toString() !== 'PGDMP') throw new Error('数据库导出格式无效');
    const attachments = zip.getEntries().filter((entry) => entry.entryName.startsWith('attachments/') && !entry.isDirectory);
    for (const entry of attachments.slice(0, 3)) {
      decryptBuffer(entry.getData(), '360note:attachment');
    }
    const next = await saveInstanceBackupSettings({
      drillEnabled: settings.drillEnabled,
      drillFrequencyHours: settings.drillFrequencyHours,
    });
    const nextWithDrill = {
      ...next,
      lastDrillAt: new Date().toISOString(),
      lastDrillOk: true,
      lastDrillError: null,
      lastDrillBackup: latest.filename,
    };
    await setSetting('instanceBackup', nextWithDrill);
    await audit({ actorId, action: 'admin.instance_backup.drill', meta: { ok: true, backup: latest.filename, attachments: attachments.length }, ip: null });
    return { ok: true, backup: latest.filename, error: null };
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    const next = await getInstanceBackupSettings();
    await setSetting('instanceBackup', {
      ...next,
      lastDrillAt: new Date().toISOString(),
      lastDrillOk: false,
      lastDrillError: message,
      lastDrillBackup: latest.filename,
    });
    await audit({ actorId, action: 'admin.instance_backup.drill', meta: { ok: false, backup: latest.filename, error: message }, ip: null });
    return { ok: false, backup: latest.filename, error: message };
  }
}

export async function runInstanceAutoBackup(): Promise<void> {
  const settings = await getInstanceBackupSettings();
  if (!settings.enabled) return;
  const last = await one<{ created_at: Date }>('SELECT created_at FROM instance_backups ORDER BY created_at DESC LIMIT 1');
  if (last && Date.now() - last.created_at.getTime() < settings.frequencyHours * 60 * 60 * 1000) return;
  const admin = await one<{ id: string }>("SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1");
  if (!admin) return;
  await createInstanceBackup(admin.id);
}


export async function runScheduledRestoreDrill(): Promise<void> {
  const settings = await getInstanceBackupSettings();
  if (!settings.enabled || !settings.drillEnabled) return;
  if (settings.lastDrillAt && Date.now() - new Date(settings.lastDrillAt).getTime() < settings.drillFrequencyHours * 60 * 60 * 1000) return;
  await runInstanceRestoreDrill(null);
}
