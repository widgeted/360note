import AdmZip from 'adm-zip';
import { one } from '../db.js';
import { decryptBuffer } from '../lib/crypto.js';
import { getObject } from '../lib/object-storage.js';
import { errors } from '../lib/errors.js';
import { inspectBackupBuffer, restoreBackup } from './backups.js';

function assertKey(key: string): string {
  const clean = key.replace(/^s3:/, '').replace(/^\/+/, '');
  if (!clean || clean.includes('..') || clean.startsWith('/')) throw errors.badRequest('对象键无效');
  return clean;
}

export async function verifyOffsiteObject(key: string) {
  const clean = assertKey(key);
  const raw = await getObject(`s3:${clean}`);
  if (clean.startsWith('attachments/')) {
    const data = decryptBuffer(raw, '360note:attachment');
    return { kind: 'attachment' as const, bytes: data.length, encryptedBytes: raw.length };
  }
  const decrypted = decryptBuffer(raw, '360note:backup');
  try {
    const info = inspectBackupBuffer(decrypted);
    return { kind: 'workspace-backup' as const, bytes: decrypted.length, ...info };
  } catch {
    /* maybe an instance backup */
  }
  let zip: AdmZip;
  try {
    zip = new AdmZip(decrypted);
  } catch {
    throw errors.badRequest('备份对象无法解密或不是有效的归档');
  }
  const manifest = zip.getEntry('manifest.json');
  const dump = zip.getEntry('database.dump');
  if (!manifest || !dump) throw errors.badRequest('不是有效的 360note 整站备份');
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(manifest.getData().toString('utf8')) as Record<string, unknown>;
  } catch {
    throw errors.badRequest('整站备份清单无法解析');
  }
  if (parsed.format !== '360note-instance-backup') throw errors.badRequest('未知的备份格式');
  return {
    kind: 'instance-backup' as const,
    bytes: decrypted.length,
    dumpBytes: dump.header.size,
    entries: zip.getEntries().length,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
  };
}

export async function restoreOffsiteWorkspaceBackup(input: {
  key: string;
  mode: 'merge' | 'replace';
  jobId: string;
}): Promise<{ workspaceId: string; workspaceName: string; result: Record<string, unknown> }> {
  const clean = assertKey(input.key);
  if (!/^backup-.*\.(3nb|nhbackup)$/i.test(clean)) {
    throw errors.badRequest('只能在这里恢复工作区备份对象；整站备份请按运维手册恢复数据库');
  }
  const raw = await getObject(`s3:${clean}`);
  const decrypted = decryptBuffer(raw, '360note:backup');
  const info = inspectBackupBuffer(decrypted);
  const workspace = await one<{ id: string; deleted_at: Date | null }>(
    'SELECT id, deleted_at FROM workspaces WHERE id = $1',
    [info.workspaceId],
  );
  if (!workspace || workspace.deleted_at) throw errors.badRequest('备份所属工作区已不存在');
  const owner = await one<{ user_id: string }>(
    `SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role = 'owner' LIMIT 1`,
    [info.workspaceId],
  );
  if (!owner) throw errors.badRequest('工作区没有可用的所有者，无法恢复');
  const result = await restoreBackup({
    workspaceId: info.workspaceId,
    userId: owner.user_id,
    buffer: decrypted,
    mode: input.mode,
    jobId: input.jobId,
  });
  return { workspaceId: info.workspaceId, workspaceName: info.workspaceName, result };
}
