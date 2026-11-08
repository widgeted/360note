import { one } from '../db.js';
import { errors } from '../lib/errors.js';
import { PERMISSIONS, type Role } from '@360note/shared';

export async function requireWorkspace(
  userId: string,
  workspaceId: string,
  action: keyof typeof PERMISSIONS = 'read',
): Promise<Role> {
  if (!workspaceId) throw errors.badRequest('缺少工作区');
  const row = await one<{ role: Role }>(
    `SELECT m.role FROM workspace_members m
     JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.workspace_id = $1 AND m.user_id = $2 AND w.deleted_at IS NULL`,
    [workspaceId, userId],
  );
  if (!row) throw errors.notFound('工作区不存在或无权访问');
  if (!PERMISSIONS[action].includes(row.role)) throw errors.forbidden();
  return row.role;
}

export async function workspaceMemberCount(workspaceId: string): Promise<number> {
  const row = await one<{ count: string }>('SELECT count(*)::text AS count FROM workspace_members WHERE workspace_id = $1', [workspaceId]);
  return Number(row?.count ?? 0);
}

export async function personalWorkspaceId(userId: string): Promise<string | null> {
  const row = await one<{ id: string }>(
    `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
     WHERE m.user_id = $1 AND w.kind = 'personal' AND w.deleted_at IS NULL LIMIT 1`,
    [userId],
  );
  return row?.id ?? null;
}
