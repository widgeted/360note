import AdmZip from 'adm-zip';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import { config, paths } from '../config.js';
import { many, one, query } from '../db.js';
import { deleteBackupFile, readBackup, safeFilename, saveBackup } from '../lib/storage.js';
import { getSetting, setSetting } from './settings.js';

const exec = promisify(execFile);

export interface InstanceBackupSettings {
  enabled: boolean;
  frequencyHours: number;
  retentionCount: number;
}

export async function getInstanceBackupSettings(): Promise<InstanceBackupSettings> {
  const value = await getSetting<Partial<InstanceBackupSettings>>('instanceBackup');
  return {
    enabled: value?.enabled === true,
    frequencyHours: Math.max(1, Number(value?.frequencyHours) || 24),
    retentionCount: Math.max(1, Number(value?.retentionCount) || 7),
  };
}

export async function saveInstanceBackupSettings(patch: Partial<InstanceBackupSettings>): Promise<InstanceBackupSettings> {
  const current = await getInstanceBackupSettings();
  const next = {
    enabled: patch.enabled ?? current.enabled,
    frequencyHours: Math.max(1, Math.min(24 * 30, Math.round(patch.frequencyHours ?? current.frequencyHours))),
    retentionCount: Math.max(1, Math.min(365, Math.round(patch.retentionCount ?? current.retentionCount))),
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
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify({
      format: '360note-instance-backup',
      version: 2,
      appVersion: config.version,
      createdAt: new Date().toISOString(),
      note: 'database.dump is pg_dump custom format; attachments/ contains AES-256-GCM encrypted attachment files from the instance data directory.',
    }, null, 2)));
    zip.addLocalFile(dumpPath);
    await fs.access(paths.attachments).then(() => zip.addLocalFolder(paths.attachments, 'attachments')).catch(() => {});
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const filename = `instance-${safeFilename(config.publicOrigin.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]/gi, '_'))}-${stamp}.3nb`;
    const size = await saveBackup(filename, zip.toBuffer());
    const row = await one<{ id: string }>(
      `INSERT INTO instance_backups (filename, storage_key, size_bytes, status, created_by)
       VALUES ($1, $2, $3, 'ready', $4) RETURNING id`,
      [filename, filename, size, userId],
    );
    await pruneInstanceBackups(await getInstanceBackupSettings());
    return { id: row!.id, filename, size };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function pruneInstanceBackups(settings: InstanceBackupSettings): Promise<void> {
  const rows = await many<{ id: string; filename: string }>(
    'SELECT id, filename FROM instance_backups ORDER BY created_at DESC',
  );
  for (const row of rows.slice(settings.retentionCount)) {
    await deleteBackupFile(row.filename).catch(() => {});
    await query('DELETE FROM instance_backups WHERE id = $1', [row.id]);
  }
}

export async function listInstanceBackups() {
  return many<{
    id: string;
    filename: string;
    size_bytes: string;
    status: string;
    created_at: Date;
  }>('SELECT id, filename, size_bytes, status, created_at FROM instance_backups ORDER BY created_at DESC');
}

export async function downloadInstanceBackup(filename: string): Promise<Buffer> {
  return readBackup(filename);
}

export async function deleteInstanceBackup(id: string): Promise<void> {
  const row = await one<{ filename: string }>('SELECT filename FROM instance_backups WHERE id = $1', [id]);
  if (!row) return;
  await deleteBackupFile(row.filename).catch(() => {});
  await query('DELETE FROM instance_backups WHERE id = $1', [id]);
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
