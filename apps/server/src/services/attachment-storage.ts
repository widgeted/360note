import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.js';
import { many, one } from '../db.js';
import { errors } from '../lib/errors.js';
import {
  attachmentObjectStorageKey,
  attachmentStorageKeyFromObject,
  attachmentStorageMigrationMode,
  getObjectStorageConfig,
  headObject,
  objectStorageConfigured,
  objectUsage,
  purgeObjects,
  setAttachmentsEnabledSetting,
  setAttachmentStorageMigrationMode,
  testObjectStorage,
} from '../lib/object-storage.js';
import {
  attachmentThumbnailStorageKey,
  readAttachment,
  saveAttachment,
} from '../lib/storage.js';

export type AttachmentMigrationPhase = 'idle' | 'enabling' | 'disabling' | 'purging';

export interface AttachmentMigrationState {
  phase: AttachmentMigrationPhase;
  running: boolean;
  processed: number;
  total: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  message: string | null;
}

let state: AttachmentMigrationState = {
  phase: 'idle',
  running: false,
  processed: 0,
  total: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  message: null,
};

export function getAttachmentMigrationState(): AttachmentMigrationState {
  return { ...state };
}

export function attachmentMigrationRunning(): boolean {
  return state.running;
}

function resetState(phase: AttachmentMigrationPhase, total: number): void {
  state = {
    phase,
    running: true,
    processed: 0,
    total,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    message: null,
  };
}

function finishState(error: string | null, message: string | null): void {
  state.running = false;
  state.error = error;
  state.message = message;
  state.finishedAt = new Date().toISOString();
  if (state.phase === 'purging' || state.phase === 'disabling') state.phase = 'idle';
  if (!error) state.phase = 'idle';
}

function localPathForKey(storageKey: string): string {
  const root = path.resolve(paths.attachments);
  const target = path.resolve(root, storageKey);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('附件路径异常');
  return target;
}

async function localSize(storageKey: string): Promise<number | null> {
  try {
    return (await fs.stat(localPathForKey(storageKey))).size;
  } catch {
    return null;
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await fn(current);
    }
  });
  await Promise.all(workers);
}

async function migrateLocalAttachment(row: { id: string; storage_key: string }): Promise<void> {
  const localKey = row.storage_key;
  const localBytes = await localSize(localKey);
  if (localBytes === null) throw new Error(`本机附件文件缺失：${localKey}`);
  const objectKey = attachmentObjectStorageKey(localKey);
  const remote = await headObject(objectKey);
  if (!remote.exists || remote.size !== localBytes) {
    const data = await readAttachment(localKey);
    await saveAttachment(objectKey, data, 's3');
  }
  const localThumb = attachmentThumbnailStorageKey(localKey);
  const localThumbBytes = await localSize(localThumb);
  if (localThumbBytes !== null) {
    const objectThumb = attachmentObjectStorageKey(localThumb);
    const remoteThumb = await headObject(objectThumb);
    if (!remoteThumb.exists || remoteThumb.size !== localThumbBytes) {
      const thumbnail = await readAttachment(localThumb);
      await saveAttachment(objectThumb, thumbnail, 's3');
    }
  }
  await one('UPDATE attachments SET storage_key = $1 WHERE id = $2 AND storage_key = $3', [
    objectKey,
    row.id,
    localKey,
  ]);
}

async function restoreObjectAttachment(row: { id: string; storage_key: string }): Promise<void> {
  const objectKey = row.storage_key;
  const localKey = attachmentStorageKeyFromObject(objectKey);
  if (!localKey || localKey.startsWith('s3:')) throw new Error(`对象存储键异常：${objectKey}`);
  const data = await readAttachment(objectKey);
  await saveAttachment(localKey, data, 'local');
  const objectThumb = attachmentThumbnailStorageKey(objectKey);
  const localThumb = attachmentThumbnailStorageKey(localKey);
  try {
    const thumbnail = await readAttachment(objectThumb);
    await saveAttachment(localThumb, thumbnail, 'local');
  } catch {
    /* Thumbnail is optional; it can be regenerated lazily. */
  }
  await one('UPDATE attachments SET storage_key = $1 WHERE id = $2 AND storage_key = $3', [
    localKey,
    row.id,
    objectKey,
  ]);
}

async function countRows(where: string): Promise<number> {
  const row = await one<{ count: string }>(
    `SELECT count(*)::text AS count FROM attachments WHERE deleted_at IS NULL AND ${where}`,
  );
  return Number(row?.count ?? 0);
}

async function pendingRows(where: string, failedIds: string[], limit: number) {
  return many<{ id: string; storage_key: string }>(
    `SELECT id, storage_key FROM attachments
     WHERE deleted_at IS NULL AND ${where} AND id <> ALL($1::uuid[])
     ORDER BY created_at LIMIT ${limit}`,
    [failedIds],
  );
}

async function sweepLocalAttachments(failedIds: string[]): Promise<number> {
  let failed = 0;
  while (true) {
    const rows = await pendingRows("storage_key NOT LIKE 's3:%'", failedIds, 50);
    if (rows.length === 0) break;
    await mapLimit(rows, 4, async (row) => {
      try {
        await migrateLocalAttachment(row);
        state.processed++;
      } catch (error) {
        failed++;
        failedIds.push(row.id);
        state.failed += 1;
        state.message = (error as Error).message;
      }
    });
    state.total = Math.max(state.total, state.processed + state.failed);
  }
  return failed;
}

async function runEnable(): Promise<void> {
  const failedIds: string[] = [];
  setAttachmentStorageMigrationMode(true);
  try {
    const failed = await sweepLocalAttachments(failedIds);
    if (failed > 0) {
      throw new Error(`有 ${failed} 个附件迁移失败，已保留原存储位置。请检查日志后重试。`);
    }
    await setAttachmentsEnabledSetting(true);
    // Uploads that arrived in the tiny window before the switch stayed local.
    // Release the lock first so new uploads go remote, then sweep the leftovers.
    setAttachmentStorageMigrationMode(false);
    const late = await sweepLocalAttachments(failedIds);
    invalidateAttachmentUsage();
    if (late > 0) {
      finishState(
        `对象存储已启用，但有 ${late} 个迁移期间上传的附件仍保存在本机，可稍后再次迁移。`,
        '新上传的附件将直接保存到对象存储。',
      );
    } else {
      finishState(null, '附件已迁移到对象存储，新上传的附件将直接保存到对象存储。');
    }
  } catch (error) {
    finishState((error as Error).message.slice(0, 500), '迁移未完成，附件仍按各自记录的位置读取。');
  } finally {
    setAttachmentStorageMigrationMode(false);
  }
}

async function runDisable(purgeRemote: boolean): Promise<void> {
  const failedIds: string[] = [];
  let failed = 0;
  setAttachmentStorageMigrationMode(true);
  try {
    while (true) {
      const rows = await pendingRows("storage_key LIKE 's3:%'", failedIds, 50);
      if (rows.length === 0) break;
      await mapLimit(rows, 4, async (row) => {
        try {
          await restoreObjectAttachment(row);
          state.processed++;
        } catch (error) {
          failed++;
          failedIds.push(row.id);
          state.failed += 1;
          state.message = (error as Error).message;
        }
      });
    }
    state.total = Math.max(state.total, state.processed + state.failed);
    if (failed > 0) {
      throw new Error(`有 ${failed} 个附件取回失败。对象存储仍保持启用，可以修复后重试。`);
    }
    await setAttachmentsEnabledSetting(false);
    invalidateAttachmentUsage();
    if (purgeRemote) {
      state.phase = 'purging';
      state.message = '附件已全部取回，正在清理对象存储中的附件副本。';
      try {
        const deleted = await purgeObjects('attachments/');
        invalidateAttachmentUsage();
        finishState(null, `附件已全部取回本机，并清理对象存储中的 ${deleted} 个附件对象。`);
      } catch (error) {
        finishState(
          `附件已全部取回本机，但清理对象存储失败：${(error as Error).message.slice(0, 300)}`,
          '附件已安全保存在本机，可稍后手动清理对象存储。',
        );
      }
    } else {
      finishState(null, '附件已全部取回本机，对象存储中的旧副本保留未删除。');
    }
  } catch (error) {
    finishState((error as Error).message.slice(0, 500), '取回未完成，对象存储附件仍可正常读取。');
  } finally {
    setAttachmentStorageMigrationMode(false);
  }
}

export async function startEnableAttachments(): Promise<AttachmentMigrationState> {
  if (state.running) throw errors.conflict('附件迁移正在进行，请稍候');
  const config = await getObjectStorageConfig();
  if (!objectStorageConfigured(config)) throw errors.badRequest('请先保存完整的对象存储连接配置');
  if (config.attachmentsEnabled) throw errors.badRequest('对象存储附件已经启用');
  await testObjectStorage(config);
  const total = await countRows("storage_key NOT LIKE 's3:%'");
  resetState('enabling', total);
  void runEnable();
  return getAttachmentMigrationState();
}

export async function startDisableAttachments(purgeRemote: boolean): Promise<AttachmentMigrationState> {
  if (state.running) throw errors.conflict('附件迁移正在进行，请稍候');
  const config = await getObjectStorageConfig();
  if (!objectStorageConfigured(config)) throw errors.badRequest('对象存储配置不完整，无法取回附件');
  const total = await countRows("storage_key LIKE 's3:%'");
  if (total === 0 && !config.attachmentsEnabled) {
    if (purgeRemote) await purgeObjects('attachments/');
    return getAttachmentMigrationState();
  }
  await testObjectStorage(config);
  resetState('disabling', total);
  void runDisable(purgeRemote);
  return getAttachmentMigrationState();
}

interface LocalUsageValue {
  files: number;
  bytes: number;
}

interface RemoteUsageValue {
  objects: number;
  bytes: number;
}

let localUsageCache: { at: number; value: LocalUsageValue } | null = null;
let remoteUsageCache: { at: number; value: { total: RemoteUsageValue; attachments: RemoteUsageValue; backups: RemoteUsageValue } } | null = null;

export function invalidateAttachmentUsage(): void {
  localUsageCache = null;
  remoteUsageCache = null;
}

async function walk(dir: string): Promise<LocalUsageValue> {
  let files = 0;
  let bytes = 0;
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { files, bytes };
  }
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walk(target);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(target);
        files += 1;
        bytes += stat.size;
      } catch {
        /* file vanished while scanning */
      }
    }
  }
  return { files, bytes };
}

export async function getLocalAttachmentUsage(force = false): Promise<LocalUsageValue> {
  if (!force && localUsageCache && Date.now() - localUsageCache.at < 30_000) return localUsageCache.value;
  const value = await walk(paths.attachments);
  localUsageCache = { at: Date.now(), value };
  return value;
}

export async function getRemoteAttachmentUsage(force = false): Promise<{
  total: RemoteUsageValue;
  attachments: RemoteUsageValue;
  backups: RemoteUsageValue;
}> {
  if (!force && remoteUsageCache && Date.now() - remoteUsageCache.at < 30_000) return remoteUsageCache.value;
  const total = await objectUsage('');
  const attachments = await objectUsage('attachments/');
  const value = {
    total,
    attachments,
    backups: {
      objects: Math.max(0, total.objects - attachments.objects),
      bytes: Math.max(0, total.bytes - attachments.bytes),
    },
  };
  remoteUsageCache = { at: Date.now(), value };
  return value;
}

export async function getAttachmentStorageUsage(force = false) {
  // Snapshot the migration before reading the config: a finished migration
  // writes the enabled flag before it clears the running flag, so this order
  // can never report "finished" together with the previous enabled state.
  const migration = getAttachmentMigrationState();
  const config = await getObjectStorageConfig();
  const [local, counts] = await Promise.all([
    getLocalAttachmentUsage(force),
    one<{ local_rows: string; remote_rows: string }>(
      `SELECT
        count(*) FILTER (WHERE storage_key NOT LIKE 's3:%')::text AS local_rows,
        count(*) FILTER (WHERE storage_key LIKE 's3:%')::text AS remote_rows
       FROM attachments WHERE deleted_at IS NULL`,
    ),
  ]);
  let remote: (Awaited<ReturnType<typeof getRemoteAttachmentUsage>> & { available: boolean; error?: string }) | null = null;
  if (objectStorageConfigured(config)) {
    try {
      remote = { available: true, ...(await getRemoteAttachmentUsage(force)) };
    } catch (error) {
      remote = {
        available: false,
        error: (error as Error).message.slice(0, 300),
        total: { objects: 0, bytes: 0 },
        attachments: { objects: 0, bytes: 0 },
        backups: { objects: 0, bytes: 0 },
      };
    }
  }
  return {
    enabled: config.enabled,
    attachmentsEnabled: config.attachmentsEnabled,
    configured: objectStorageConfigured(config),
    local: {
      files: local.files,
      bytes: local.bytes,
      attachments: Number(counts?.local_rows ?? 0),
    },
    remote: remote
      ? {
          ...remote,
          attachmentsCount: Number(counts?.remote_rows ?? 0),
        }
      : null,
    migration,
    migrating: attachmentStorageMigrationMode(),
  };
}
