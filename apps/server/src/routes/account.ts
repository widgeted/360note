import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, transaction } from '../db.js';
import { clearSessionCookie, clientIp, requireAuth } from '../auth.js';
import { audit } from '../lib/audit.js';
import { errors } from '../lib/errors.js';
import { verifyPassword } from '../lib/passwords.js';
import { parse } from '../lib/validate.js';
import { deleteAttachment, deleteBackupFile } from '../lib/storage.js';
import { createUserExport } from '../services/user-export.js';
import { deleteOffsiteBackup } from '../services/offsite.js';

export default async function accountRoutes(app: FastifyInstance) {
  app.post('/api/me/export', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request) => {
    const auth = requireAuth(request);
    try {
      const result = await createUserExport({
        userId: auth.user.id,
        email: auth.user.email,
        displayName: auth.user.display_name,
        prefs: auth.user.prefs,
      });
      await audit({
        actorId: auth.user.id,
        action: 'account.export',
        targetType: 'user',
        targetId: auth.user.id,
        meta: { ok: true },
        ip: clientIp(request),
      });
      return result;
    } catch (error) {
      await audit({
        actorId: auth.user.id,
        action: 'account.export.failed',
        targetType: 'user',
        targetId: auth.user.id,
        meta: { ok: false, error: (error as Error).message.slice(0, 500) },
        ip: clientIp(request),
      });
      throw error;
    }
  });

  app.delete('/api/me', async (request, reply) => {
    const auth = requireAuth(request);
    const body = parse(z.object({ password: z.string().min(1), confirm: z.literal('DELETE') }), request.body);
    if (!(await verifyPassword(body.password, auth.user.password_hash))) throw errors.badRequest('密码不正确');

    const owned = await many<{ id: string; kind: string; member_count: string; owner_id: string }>(
      `SELECT w.id, w.kind, w.owner_id, (SELECT count(*)::text FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count
       FROM workspaces w WHERE w.owner_id = $1 AND w.deleted_at IS NULL`,
      [auth.user.id],
    );
    for (const workspace of owned) {
      if (workspace.kind === 'team' && Number(workspace.member_count) > 1) {
        throw errors.badRequest('你仍是团队空间的所有者，请先转移所有权或删除空间后再注销账号');
      }
    }

    const ownedIds = owned.map((workspace) => workspace.id);
    const storageKeys = ownedIds.length
      ? await many<{ storage_key: string }>(
          `SELECT storage_key FROM attachments WHERE workspace_id = ANY($1::uuid[])`,
          [ownedIds],
        )
      : [];
    const backupFiles = ownedIds.length
      ? await many<{ filename: string }>(
          `SELECT filename FROM backups WHERE workspace_id = ANY($1::uuid[])`,
          [ownedIds],
        )
      : [];

    // Preserve shared team content: only the account, not other members' notes, should disappear.
    const exportFiles = await many<{ filename: string }>('SELECT filename FROM user_export_links WHERE user_id = $1', [auth.user.id]);
    await transaction(async (client) => {
      // Preserve the human-readable author before the FK nulls user_id.
      await client.query(
        `UPDATE comments c SET guest_name = COALESCE(c.guest_name, u.display_name)
         FROM users u WHERE c.user_id = u.id AND u.id = $1`,
        [auth.user.id],
      );
      // Reassign every content reference in every workspace this user does not
      // own. This covers notes last edited by the user and content in spaces the
      // user already left, not just current memberships.
      await client.query(
        `UPDATE notes n
         SET created_by = w.owner_id,
             updated_by = CASE WHEN n.updated_by = $1 THEN w.owner_id ELSE n.updated_by END
         FROM workspaces w
         WHERE n.workspace_id = w.id AND w.owner_id <> $1
           AND (n.created_by = $1 OR n.updated_by = $1)`,
        [auth.user.id],
      );
      await client.query(
        `UPDATE attachments a SET created_by = w.owner_id
         FROM workspaces w
         WHERE a.workspace_id = w.id AND w.owner_id <> $1 AND a.created_by = $1`,
        [auth.user.id],
      );
      await client.query(
        `UPDATE share_links s SET created_by = w.owner_id
         FROM notes n JOIN workspaces w ON w.id = n.workspace_id
         WHERE s.note_id = n.id AND w.owner_id <> $1 AND s.created_by = $1`,
        [auth.user.id],
      );
      for (const workspace of owned) {
        await client.query('DELETE FROM workspaces WHERE id = $1', [workspace.id]);
      }
      await client.query('DELETE FROM jobs WHERE created_by = $1', [auth.user.id]);
      await client.query('DELETE FROM user_export_links WHERE user_id = $1', [auth.user.id]);
      await client.query('DELETE FROM users WHERE id = $1', [auth.user.id]);
    });
    await Promise.all([
      ...storageKeys.map((row) => deleteAttachment(row.storage_key).catch(() => {})),
      ...backupFiles.map((row) => deleteBackupFile(row.filename).catch(() => {})),
      ...backupFiles.map((row) => deleteOffsiteBackup(row.filename).catch(() => {})),
      ...exportFiles.map((row) => deleteBackupFile(row.filename).catch(() => {})),
    ]);
    await audit({ actorId: null, action: 'account.delete', targetType: 'user', targetId: auth.user.id, meta: { email: auth.user.email }, ip: clientIp(request) });
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });
}
