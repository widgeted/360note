import archiver from 'archiver';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { many, one, query } from '../db.js';
import { errors } from '../lib/errors.js';
import { deleteBackupFile, safeFilename, saveBackupFromFile } from '../lib/storage.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { isReservedMailAddress, normalizeLocale, sendUserExportEmail } from '../lib/mailer.js';
import { createBackupArchive } from './backups.js';
import { config } from '../config.js';

const EXPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function createUserExport(input: {
  userId: string;
  email: string;
  displayName: string;
  prefs: Record<string, unknown>;
}): Promise<{ emailed: boolean; expiresAt: string }> {
  const latest = await one<{ created_at: Date }>(
    'SELECT created_at FROM user_export_links WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [input.userId],
  );
  if (latest && Date.now() - latest.created_at.getTime() < EXPORT_COOLDOWN_MS) {
    const remaining = Math.ceil((EXPORT_COOLDOWN_MS - (Date.now() - latest.created_at.getTime())) / 3600000);
    throw errors.tooMany(`每 24 小时最多导出一次，请在约 ${remaining} 小时后重试`);
  }
  if (isReservedMailAddress(input.email)) {
    throw errors.badRequest('当前账户邮箱为保留测试域名，无法发送导出链接');
  }

  const workspaces = await many<{ id: string; name: string }>(
    `SELECT w.id, w.name FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
     WHERE m.user_id = $1 AND w.owner_id = $1 AND w.deleted_at IS NULL ORDER BY w.created_at`,
    [input.userId],
  );
  if (!workspaces.length) throw errors.badRequest('没有可导出的自有空间');

  const expired = await many<{ id: string; filename: string }>(
    'SELECT id, filename FROM user_export_links WHERE user_id = $1 AND expires_at < now()',
    [input.userId],
  );
  for (const row of expired) {
    await deleteBackupFile(row.filename).catch(() => {});
    await query('DELETE FROM user_export_links WHERE id = $1', [row.id]);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '360note-user-export-'));
  const archivePath = path.join(tempDir, 'export.zip');
  const output = fsSync.createWriteStream(archivePath, { mode: 0o600, flags: 'wx' });
  const archive = archiver('zip', { zlib: { level: 6 } });
  const finished = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  const filename = `user-export-${input.userId}-${Date.now()}.3nb`;
  try {
    archive.append(
      '360note data export\n\nThis archive contains one .3nb per workspace owned by the account. Keep it private.\n',
      { name: 'README.txt' },
    );
    const used = new Set<string>();
    for (const [index, workspace] of workspaces.entries()) {
      const innerPath = path.join(tempDir, `workspace-${index}.zip`);
      const { name } = await createBackupArchive(workspace.id, innerPath);
      let entry = safeFilename(name);
      let suffix = 2;
      while (used.has(entry)) {
        entry = safeFilename(name.replace(/\.3nb$/, `-${suffix}.3nb`));
        suffix += 1;
      }
      used.add(entry);
      archive.file(innerPath, { name: entry });
    }
    await archive.finalize();
    await finished;
    await saveBackupFromFile(filename, archivePath);
  } catch (error) {
    archive.abort();
    output.destroy();
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const row = await one<{ id: string }>(
    `INSERT INTO user_export_links (user_id, token_hash, filename, created_by, expires_at)
     VALUES ($1, $2, $3, $1, $4) RETURNING id`,
    [input.userId, sha256(token), filename, expiresAt],
  );
  try {
    await sendUserExportEmail({
      to: input.email,
      displayName: input.displayName,
      url: `${config.publicOrigin}/api/user-exports/${token}`,
      expiresAt: expiresAt.toISOString(),
      locale: normalizeLocale(input.prefs?.locale),
    });
  } catch (error) {
    await deleteBackupFile(filename).catch(() => {});
    await query('DELETE FROM user_export_links WHERE id = $1', [row!.id]);
    throw errors.badRequest(`导出文件已生成，但邮件发送失败：${(error as Error).message}`);
  }
  return { emailed: true, expiresAt: expiresAt.toISOString() };
}
