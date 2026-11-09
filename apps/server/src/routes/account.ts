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

export default async function accountRoutes(app: FastifyInstance) {
  app.post('/api/me/export', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request) => {
    const auth = requireAuth(request);
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
      ip: clientIp(request),
    });
    return result;
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
    const memberships = await many<{ workspace_id: string; owner_id: string }>(
      `SELECT wm.workspace_id, w.owner_id FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = $1 AND w.owner_id <> $1 AND w.deleted_at IS NULL`,
      [auth.user.id],
    );
    await transaction(async (client) => {
      for (const membership of memberships) {
        await client.query(
          `UPDATE notes SET created_by = $2, updated_by = CASE WHEN updated_by = $1 THEN $2 ELSE updated_by END
           WHERE workspace_id = $3 AND created_by = $1`,
          [auth.user.id, membership.owner_id, membership.workspace_id],
        );
        await client.query(
          `UPDATE attachments SET created_by = $2 WHERE workspace_id = $3 AND created_by = $1`,
          [auth.user.id, membership.owner_id, membership.workspace_id],
        );
        await client.query(
          `UPDATE share_links SET created_by = $2 WHERE note_id IN (SELECT id FROM notes WHERE workspace_id = $3) AND created_by = $1`,
          [auth.user.id, membership.owner_id, membership.workspace_id],
        );
      }
      for (const workspace of owned) {
        await client.query('DELETE FROM workspaces WHERE id = $1', [workspace.id]);
      }
      await client.query('DELETE FROM users WHERE id = $1', [auth.user.id]);
    });
    await Promise.all([
      ...storageKeys.map((row) => deleteAttachment(row.storage_key).catch(() => {})),
      ...backupFiles.map((row) => deleteBackupFile(row.filename).catch(() => {})),
      ...exportFiles.map((row) => deleteBackupFile(row.filename).catch(() => {})),
    ]);
    await audit({ actorId: null, action: 'account.delete', targetType: 'user', targetId: auth.user.id, meta: { email: auth.user.email }, ip: clientIp(request) });
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });
}
