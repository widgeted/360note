import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { many, one, query, transaction } from '../db.js';
import { clientIp, requireAuth } from '../auth.js';
import { audit } from '../lib/audit.js';
import { decryptString, encryptString, randomToken, safeEqual, sha256 } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { emailSchema, parse } from '../lib/validate.js';
import { avatarColor } from '../lib/seed.js';
import { requireWorkspace, workspaceKind, workspaceMemberCount } from '../services/workspaces.js';
import { notify } from '../services/sessions.js';
import { deleteAttachment, deleteBackupFile } from '../lib/storage.js';
import { cleanupNotesMedia } from '../services/media.js';
import type { DbUser } from '../lib/users.js';
import { originFromRequest } from '../lib/origin.js';
import { mailEnabled, normalizeLocale, sendWorkspaceInviteEmail } from '../lib/mailer.js';
import { deleteOffsiteBackup } from '../services/offsite.js';
import { passwordIssues } from '../lib/passwords.js';
import {
  deriveVaultKek,
  generateVaultRecoveryKey,
  randomVaultKey,
  randomVaultSalt,
  recoveryKek,
  recoveryKeyHash,
  unwrapVaultKey,
  vaultKeyAad,
  vaultRecoveryAad,
  wrapVaultKey,
} from '../lib/vault-crypto.js';
import { activeVaultKey, clearVaultKey, clearWorkspaceVaultKeys, parseVaultHeader, setVaultKey, vaultKeyExpiresAt } from '../lib/vault-session.js';

const roleSchema = z.enum(['admin', 'editor', 'viewer']);
const memberRoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer']);

function inviteUrl(token: string, request: FastifyRequest): string {
  return `${originFromRequest(request)}/invite/${token}`;
}

export default async function workspaceRoutes(app: FastifyInstance) {
  app.get('/api/workspaces', async (request) => {
    const auth = requireAuth(request);
    const rows = await many<{
      id: string;
      name: string;
      kind: string;
      icon: string;
      color: string;
      owner_id: string;
      role: string;
      created_at: Date;
      updated_at: Date;
      member_count: string;
    }>(
      `SELECT w.id, w.name, w.kind, w.icon, w.color, w.owner_id, m.role, w.created_at, w.updated_at,
              (SELECT count(*)::text FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count
       FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
       WHERE w.deleted_at IS NULL ORDER BY w.kind = 'personal' DESC, w.created_at ASC`,
      [auth.user.id],
    );
    return {
      workspaces: rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        icon: row.icon,
        color: row.color,
        ownerId: row.owner_id,
        role: row.role,
        memberCount: Number(row.member_count),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  });

  app.post('/api/workspaces', async (request) => {
    const auth = requireAuth(request);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(80),
        kind: z.enum(['personal', 'team', 'vault']).default('team'),
        icon: z.string().trim().min(1).max(16).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        vaultPassword: z.string().min(1).max(200).optional(),
      }),
      request.body,
    );
    const vault = body.kind === 'vault';
    if (vault) {
      if (!body.vaultPassword) throw errors.badRequest('请为加密空间设置空间密码');
      const issues = passwordIssues(body.vaultPassword);
      if (issues.length) throw errors.badRequest(issues[0]);
    }
    const icon = body.icon ?? (body.kind === 'team' ? '👥' : body.kind === 'vault' ? '🔒' : '📔');
    const color = body.color ?? '#17865b';
    const salt = vault ? randomVaultSalt() : null;
    const dataKey = vault ? randomVaultKey() : null;
    const recoveryKey = vault ? generateVaultRecoveryKey() : null;
    let workspaceId = '';
    const workspace = await transaction(async (client) => {
      const row = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO workspaces (name, kind, icon, color, owner_id, vault_salt, vault_key_wrapped, vault_recovery_hash, vault_recovery_wrapped, vault_created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, created_at`,
        [body.name, body.kind, icon, color, auth.user.id, null, null, null, null, vault ? new Date() : null],
      );
      workspaceId = row.rows[0].id;
      if (vault && salt && dataKey && recoveryKey) {
        const kek = await deriveVaultKek(body.vaultPassword!, salt);
        const wrapped = wrapVaultKey(dataKey, kek, vaultKeyAad(workspaceId));
        const recoveryWrap = wrapVaultKey(dataKey, recoveryKek(recoveryKey), vaultRecoveryAad(workspaceId));
        await client.query(
          `UPDATE workspaces SET vault_salt = $2, vault_key_wrapped = $3, vault_recovery_hash = $4, vault_recovery_wrapped = $5 WHERE id = $1`,
          [workspaceId, salt.toString('base64'), wrapped, recoveryKeyHash(recoveryKey), recoveryWrap],
        );
      }
      await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [
        row.rows[0].id,
        auth.user.id,
      ]);
      return row.rows[0];
    });
    let vaultToken: string | undefined;
    if (vault && dataKey) {
      const sessionId = auth.session?.id;
      if (sessionId) {
        const token = randomToken(32);
        const expiresAt = setVaultKey(workspace.id, token, sessionId, dataKey);
        await rememberUnlock(workspace.id, auth.user.id, sessionId, token, expiresAt);
        vaultToken = vaultTokenValue(workspace.id, token);
      }
      dataKey.fill(0);
    }
    await audit({ workspaceId: workspace.id, actorId: auth.user.id, action: 'workspace.create', targetType: 'workspace', targetId: workspace.id, meta: { kind: body.kind }, ip: clientIp(request) });
    return {
      workspace: {
        id: workspace.id,
        name: body.name,
        kind: body.kind,
        icon,
        color,
        ownerId: auth.user.id,
        role: 'owner',
        memberCount: 1,
        createdAt: workspace.created_at.toISOString(),
        updatedAt: workspace.created_at.toISOString(),
      },
      recoveryKey: recoveryKey ?? undefined,
      vaultToken,
    };
  });

  async function membership(id: string, userId: string): Promise<{ kind: string; role: string }> {
    const row = await one<{ kind: string; role: string }>(
      `SELECT w.kind, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
       WHERE w.id = $1 AND m.user_id = $2 AND w.deleted_at IS NULL`,
      [id, userId],
    );
    if (!row) throw errors.notFound('工作区不存在或无权访问');
    return row;
  }

  async function rejectVaultMembers(id: string): Promise<void> {
    if ((await workspaceKind(id)) === 'vault') {
      throw errors.forbidden('加密空间只属于所有者，不支持成员、邀请或所有权转移');
    }
  }

  function vaultTokenValue(id: string, token: string): string {
    return `${id}.${token}`;
  }

  async function rememberUnlock(workspaceId: string, userId: string, sessionId: string, token: string, expiresAt: number): Promise<void> {
    await one(
      `INSERT INTO workspace_unlocks (workspace_id, user_id, session_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, session_id)
       DO UPDATE SET token_hash = EXCLUDED.token_hash, last_used_at = now(), expires_at = EXCLUDED.expires_at`,
      [workspaceId, userId, sessionId, sha256(token), new Date(expiresAt)],
    );
  }

  app.get('/api/workspaces/:id/vault/status', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const member = await membership(id, auth.user.id);
    if (member.kind !== 'vault') return { vault: false, unlocked: true, expiresAt: null };
    const parsed = parseVaultHeader(request.headers['x-360note-vault'] as string | undefined);
    const expiresAt = parsed && parsed.workspaceId === id ? vaultKeyExpiresAt(id, parsed.token, auth.session?.id) : null;
    return { vault: true, unlocked: Boolean(expiresAt), expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null };
  });

  app.post('/api/workspaces/:id/vault/unlock', {
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
  }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(z.object({ password: z.string().min(1).max(200) }), request.body);
    const member = await membership(id, auth.user.id);
    if (member.kind !== 'vault') return { unlocked: true };
    if (!auth.session?.id) throw errors.forbidden('加密空间需要在浏览器会话中解锁');
    const row = await one<{ vault_salt: string | null; vault_key_wrapped: string | null }>(
      'SELECT vault_salt, vault_key_wrapped FROM workspaces WHERE id = $1',
      [id],
    );
    if (!row?.vault_salt || !row.vault_key_wrapped) throw errors.internal('加密空间缺少密钥材料');
    try {
      const kek = await deriveVaultKek(body.password, Buffer.from(row.vault_salt, 'base64'));
      const dataKey = unwrapVaultKey(row.vault_key_wrapped, kek, vaultKeyAad(id));
      const token = randomToken(32);
      const expiresAt = setVaultKey(id, token, auth.session.id, dataKey);
      dataKey.fill(0);
      await rememberUnlock(id, auth.user.id, auth.session.id, token, expiresAt);
      await audit({ workspaceId: id, actorId: auth.user.id, action: 'vault.unlock', targetType: 'workspace', targetId: id, ip: clientIp(request) });
      return { unlocked: true, vaultToken: vaultTokenValue(id, token), expiresAt: new Date(expiresAt).toISOString() };
    } catch {
      await audit({ workspaceId: id, actorId: auth.user.id, action: 'vault.unlock.failed', targetType: 'workspace', targetId: id, ip: clientIp(request) });
      throw errors.forbidden('空间密码不正确');
    }
  });

  app.post('/api/workspaces/:id/vault/lock', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await membership(id, auth.user.id);
    const parsed = parseVaultHeader(request.headers['x-360note-vault'] as string | undefined);
    if (parsed && parsed.workspaceId === id) clearVaultKey(id, parsed.token);
    if (auth.session?.id) {
      await query('DELETE FROM workspace_unlocks WHERE workspace_id = $1 AND session_id = $2', [id, auth.session.id]);
    }
    await audit({ workspaceId: id, actorId: auth.user.id, action: 'vault.lock', targetType: 'workspace', targetId: id, ip: clientIp(request) });
    return { ok: true };
  });

  app.post('/api/workspaces/:id/vault/touch', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await requireWorkspace(auth.user.id, id, 'read');
    const parsed = parseVaultHeader(request.headers['x-360note-vault'] as string | undefined);
    const expiresAt = parsed && parsed.workspaceId === id ? vaultKeyExpiresAt(id, parsed.token, auth.session?.id) : null;
    if (!expiresAt || !auth.session || !parsed) throw errors.locked('加密空间已锁定，请输入空间密码');
    await one('UPDATE workspace_unlocks SET last_used_at = now(), expires_at = $4 WHERE workspace_id = $1 AND session_id = $2 AND token_hash = $3', [
      id,
      auth.session.id,
      sha256(parsed.token),
      new Date(expiresAt),
    ]);
    return { unlocked: true, expiresAt: new Date(expiresAt).toISOString() };
  });

  app.post('/api/workspaces/:id/vault/password', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await requireWorkspace(auth.user.id, id, 'manage');
    const member = await membership(id, auth.user.id);
    if (member.kind !== 'vault') throw errors.badRequest('这不是加密空间');
    if (member.role !== 'owner') throw errors.forbidden('只有空间所有者可以修改空间密码');
    const body = parse(
      z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }),
      request.body,
    );
    const issues = passwordIssues(body.newPassword);
    if (issues.length) throw errors.badRequest(issues[0]);
    const currentKey = activeVaultKey(id);
    if (!currentKey) throw errors.locked('加密空间已锁定，请输入空间密码');
    const row = await one<{ vault_salt: string | null; vault_key_wrapped: string | null }>(
      'SELECT vault_salt, vault_key_wrapped FROM workspaces WHERE id = $1',
      [id],
    );
    if (!row?.vault_salt || !row.vault_key_wrapped) throw errors.internal('加密空间缺少密钥材料');
    try {
      const oldKek = await deriveVaultKek(body.currentPassword, Buffer.from(row.vault_salt, 'base64'));
      const dataKey = unwrapVaultKey(row.vault_key_wrapped, oldKek, vaultKeyAad(id));
      const salt = randomVaultSalt();
      const kek = await deriveVaultKek(body.newPassword, salt);
      const wrapped = wrapVaultKey(dataKey, kek, vaultKeyAad(id));
      await one('UPDATE workspaces SET vault_salt = $2, vault_key_wrapped = $3 WHERE id = $1', [id, salt.toString('base64'), wrapped]);
      clearWorkspaceVaultKeys(id);
      let vaultToken: string | undefined;
      if (auth.session?.id) {
        const token = randomToken(32);
        const expiresAt = setVaultKey(id, token, auth.session.id, dataKey);
        await rememberUnlock(id, auth.user.id, auth.session.id, token, expiresAt);
        vaultToken = vaultTokenValue(id, token);
      }
      dataKey.fill(0);
      await audit({ workspaceId: id, actorId: auth.user.id, action: 'vault.password', targetType: 'workspace', targetId: id, ip: clientIp(request) });
      return { ok: true, vaultToken };
    } catch {
      throw errors.forbidden('当前空间密码不正确');
    }
  });

  app.post('/api/workspaces/:id/vault/recovery', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const member = await membership(id, auth.user.id);
    if (member.kind !== 'vault' || member.role !== 'owner') throw errors.forbidden('只有空间所有者可以恢复加密空间');
    const body = parse(
      z.object({ recoveryKey: z.string().min(16).max(200), newPassword: z.string().min(1).max(200) }),
      request.body,
    );
    const issues = passwordIssues(body.newPassword);
    if (issues.length) throw errors.badRequest(issues[0]);
    const row = await one<{ vault_recovery_hash: string | null; vault_recovery_wrapped: string | null }>(
      'SELECT vault_recovery_hash, vault_recovery_wrapped FROM workspaces WHERE id = $1',
      [id],
    );
    if (!row?.vault_recovery_hash || !row.vault_recovery_wrapped) throw errors.badRequest('此空间没有恢复密钥');
    if (!safeEqual(recoveryKeyHash(body.recoveryKey), row.vault_recovery_hash)) {
      await audit({ workspaceId: id, actorId: auth.user.id, action: 'vault.recover.failed', targetType: 'workspace', targetId: id, ip: clientIp(request) });
      throw errors.forbidden('恢复密钥不正确');
    }
    let dataKey: Buffer;
    try {
      dataKey = unwrapVaultKey(row.vault_recovery_wrapped, recoveryKek(body.recoveryKey), vaultRecoveryAad(id));
    } catch {
      throw errors.forbidden('恢复密钥不正确');
    }
    const salt = randomVaultSalt();
    const kek = await deriveVaultKek(body.newPassword, salt);
    const wrapped = wrapVaultKey(dataKey, kek, vaultKeyAad(id));
    const newRecoveryKey = generateVaultRecoveryKey();
    const newRecoveryWrapped = wrapVaultKey(dataKey, recoveryKek(newRecoveryKey), vaultRecoveryAad(id));
    await one(
      `UPDATE workspaces SET vault_salt = $2, vault_key_wrapped = $3, vault_recovery_hash = $4, vault_recovery_wrapped = $5 WHERE id = $1`,
      [id, salt.toString('base64'), wrapped, recoveryKeyHash(newRecoveryKey), newRecoveryWrapped],
    );
    clearWorkspaceVaultKeys(id);
    let vaultToken: string | undefined;
    if (auth.session?.id) {
      const token = randomToken(32);
      const expiresAt = setVaultKey(id, token, auth.session.id, dataKey);
      await rememberUnlock(id, auth.user.id, auth.session.id, token, expiresAt);
      vaultToken = vaultTokenValue(id, token);
    }
    dataKey.fill(0);
    await audit({ workspaceId: id, actorId: auth.user.id, action: 'vault.recover', targetType: 'workspace', targetId: id, ip: clientIp(request) });
    return { recoveryKey: newRecoveryKey, vaultToken };
  });

  app.post('/api/workspaces/:id/vault/recovery/regenerate', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await requireWorkspace(auth.user.id, id, 'manage');
    const member = await membership(id, auth.user.id);
    if (member.kind !== 'vault' || member.role !== 'owner') throw errors.forbidden('只有空间所有者可以重置恢复密钥');
    const body = parse(z.object({ password: z.string().min(1).max(200) }), request.body);
    const row = await one<{ vault_salt: string | null; vault_key_wrapped: string | null }>(
      'SELECT vault_salt, vault_key_wrapped FROM workspaces WHERE id = $1',
      [id],
    );
    if (!row?.vault_salt || !row.vault_key_wrapped) throw errors.internal('加密空间缺少密钥材料');
    let dataKey: Buffer;
    try {
      const kek = await deriveVaultKek(body.password, Buffer.from(row.vault_salt, 'base64'));
      dataKey = unwrapVaultKey(row.vault_key_wrapped, kek, vaultKeyAad(id));
    } catch {
      throw errors.forbidden('空间密码不正确');
    }
    const recoveryKey = generateVaultRecoveryKey();
    const wrapped = wrapVaultKey(dataKey, recoveryKek(recoveryKey), vaultRecoveryAad(id));
    await one('UPDATE workspaces SET vault_recovery_hash = $2, vault_recovery_wrapped = $3 WHERE id = $1', [
      id,
      recoveryKeyHash(recoveryKey),
      wrapped,
    ]);
    dataKey.fill(0);
    await audit({ workspaceId: id, actorId: auth.user.id, action: 'vault.recovery.regenerate', targetType: 'workspace', targetId: id, ip: clientIp(request) });
    return { recoveryKey };
  });

  app.patch('/api/workspaces/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await requireWorkspace(auth.user.id, id, 'manage');
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(80).optional(),
        icon: z.string().trim().min(1).max(16).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      }),
      request.body,
    );
    const current = await one<{ name: string; icon: string; color: string }>(
      'SELECT name, icon, color FROM workspaces WHERE id = $1',
      [id],
    );
    if (!current) throw errors.notFound('工作区不存在');
    const name = body.name ?? current.name;
    const icon = body.icon ?? current.icon;
    const color = body.color ?? current.color;
    const row = await one<{ id: string; name: string; icon: string; color: string; updated_at: Date }>(
      'UPDATE workspaces SET name = $2, icon = $3, color = $4, updated_at = now() WHERE id = $1 RETURNING id, name, icon, color, updated_at',
      [id, name, icon, color],
    );
    await audit({ workspaceId: id, actorId: auth.user.id, action: 'workspace.rename', targetType: 'workspace', targetId: id, meta: { name, icon, color }, ip: clientIp(request) });
    return {
      workspace: {
        id: row!.id,
        name: row!.name,
        icon: row!.icon,
        color: row!.color,
        updatedAt: row!.updated_at.toISOString(),
      },
    };
  });

  app.delete('/api/workspaces/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const target = await one<{ kind: string; name: string; role: string }>(
      `SELECT w.kind, w.name, m.role FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $2
       WHERE w.id = $1 AND w.deleted_at IS NULL`,
      [id, auth.user.id],
    );
    if (!target) throw errors.notFound('工作区不存在或无权访问');
    // Deleting a vault does not reveal content, so it stays possible even if
    // the password/recovery key was lost. Only the owner may do it.
    if (target.kind === 'vault') {
      if (target.role !== 'owner') throw errors.forbidden('只有空间所有者可以删除加密空间');
    } else {
      await requireWorkspace(auth.user.id, id, 'transfer');
    }
    const workspace = { kind: target.kind, name: target.name };
    const remaining = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM workspace_members WHERE user_id = $1`,
      [auth.user.id],
    );
    if (Number(remaining?.count ?? 0) <= 1) throw errors.badRequest('至少保留一个空间');
    const attachments = await many<{ storage_key: string }>('SELECT storage_key FROM attachments WHERE workspace_id = $1', [id]);
    const noteIds = await many<{ id: string }>('SELECT id FROM notes WHERE workspace_id = $1', [id]);
    const backups = await many<{ filename: string }>('SELECT filename FROM backups WHERE workspace_id = $1', [id]);
    await audit({ workspaceId: id, actorId: auth.user.id, action: 'workspace.delete', targetType: 'workspace', targetId: id, meta: { name: workspace?.name }, ip: clientIp(request) });
    await cleanupNotesMedia(noteIds.map((row) => row.id));
    clearWorkspaceVaultKeys(id);
    await one('DELETE FROM workspaces WHERE id = $1 RETURNING id', [id]);
    await query("DELETE FROM jobs WHERE payload->>'workspaceId' = $1", [id]);
    await Promise.all([
      ...attachments.map((row) => deleteAttachment(row.storage_key).catch(() => {})),
      ...backups.map((row) => deleteBackupFile(row.filename).catch(() => {})),
      ...backups.map((row) => deleteOffsiteBackup(row.filename).catch(() => {})),
    ]);
    return { ok: true };
  });

  app.get('/api/workspaces/:id/members', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await requireWorkspace(auth.user.id, id, 'read');
    const rows = await many<{
      user_id: string;
      email: string;
      display_name: string;
      avatar_color: string;
      role: string;
      created_at: Date;
    }>(
      `SELECT m.user_id, u.email, u.display_name, u.avatar_color, m.role, m.created_at
       FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1 AND u.deleted_at IS NULL
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, u.display_name`,
      [id],
    );
    return {
      members: rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        avatarColor: row.avatar_color,
        role: row.role,
        joinedAt: row.created_at.toISOString(),
      })),
    };
  });

  app.patch('/api/workspaces/:id/members/:userId', async (request) => {
    const auth = requireAuth(request);
    const { id, userId } = parse(z.object({ id: z.string().uuid(), userId: z.string().uuid() }), request.params);
    const actorRole = await requireWorkspace(auth.user.id, id, 'manage');
    await rejectVaultMembers(id);
    const body = parse(z.object({ role: memberRoleSchema }), request.body);
    if (body.role === 'owner' && actorRole !== 'owner') throw errors.forbidden('只有所有者可以转移所有权');
    const target = await one<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [id, userId]);
    if (!target) throw errors.notFound('成员不存在');
    if (target.role === 'owner' && body.role !== 'owner') {
      throw errors.badRequest('请先转移所有权，不能直接移除所有者');
    }
    if (body.role === 'owner') {
      await transaction(async (client) => {
        await client.query(`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = $1 AND role = 'owner'`, [id]);
        await client.query(`UPDATE workspace_members SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2`, [id, userId]);
        await client.query('UPDATE workspaces SET owner_id = $2, updated_at = now() WHERE id = $1', [id, userId]);
      });
    } else {
      await one('UPDATE workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id', [id, userId, body.role]);
    }
    await audit({ workspaceId: id, actorId: auth.user.id, action: 'member.role', targetType: 'user', targetId: userId, meta: { role: body.role }, ip: clientIp(request) });
    return { ok: true };
  });

  app.delete('/api/workspaces/:id/members/:userId', async (request) => {
    const auth = requireAuth(request);
    const { id, userId } = parse(z.object({ id: z.string().uuid(), userId: z.string().uuid() }), request.params);
    await requireWorkspace(auth.user.id, id, 'manage');
    await rejectVaultMembers(id);
    if (userId === auth.user.id) throw errors.badRequest('不能移除自己，请使用“离开空间”');
    const target = await one<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [id, userId]);
    if (!target) throw errors.notFound('成员不存在');
    if (target.role === 'owner') throw errors.badRequest('不能移除空间所有者');
    await one('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id', [id, userId]);
    await audit({ workspaceId: id, actorId: auth.user.id, action: 'member.remove', targetType: 'user', targetId: userId, ip: clientIp(request) });
    return { ok: true };
  });

  app.post('/api/workspaces/:id/leave', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const role = await requireWorkspace(auth.user.id, id, 'read');
    await rejectVaultMembers(id);
    if (role === 'owner') throw errors.badRequest('所有者需要先转移所有权');
    await one('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id', [id, auth.user.id]);
    return { ok: true };
  });

  app.get('/api/workspaces/:id/invitations', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await requireWorkspace(auth.user.id, id, 'manage');
    await rejectVaultMembers(id);
    const rows = await many<{
      id: string;
      email: string;
      role: string;
      status: string;
      created_at: Date;
      expires_at: Date;
      token_cipher: string;
      inviter_name: string | null;
    }>(
      `SELECT i.*, u.display_name AS inviter_name FROM workspace_invitations i
       LEFT JOIN users u ON u.id = i.inviter_id
       WHERE i.workspace_id = $1 AND i.status = 'pending' ORDER BY i.created_at DESC`,
      [id],
    );
    return {
      invitations: rows.map((row) => ({
        id: row.id,
        workspaceId: id,
        email: row.email,
        role: row.role,
        status: row.status,
        inviterName: row.inviter_name ?? undefined,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        url: inviteUrl(decryptString(row.token_cipher, `invite:${row.id}`), request),
      })),
    };
  });

  app.post('/api/workspaces/:id/invitations', {
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const actorRole = await requireWorkspace(auth.user.id, id, 'manage');
    const workspaceRow = await one<{ kind: string }>('SELECT kind FROM workspaces WHERE id = $1', [id]);
    if (workspaceRow?.kind === 'personal') throw errors.forbidden('个人空间是私密的，不能邀请成员');
    if (workspaceRow?.kind === 'vault') throw errors.forbidden('加密空间只属于所有者，不能邀请成员');
    const body = parse(z.object({ email: emailSchema, role: roleSchema.default('editor') }), request.body);
    if (body.role === 'admin' && actorRole !== 'owner') throw errors.forbidden('只有所有者可以邀请管理员');
    const existingMember = await one<{ user_id: string }>(
      `SELECT m.user_id FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1 AND lower(u.email) = lower($2)`,
      [id, body.email],
    );
    if (existingMember) throw errors.conflict('该用户已经是空间成员');
    const pending = await one<{ id: string }>(
      `SELECT id FROM workspace_invitations WHERE workspace_id = $1 AND lower(email) = lower($2) AND status = 'pending'`,
      [id, body.email],
    );
    if (pending) throw errors.conflict('已经向这个邮箱发送过邀请');

    const token = randomToken(24);
    const invitee = await one<DbUser>('SELECT * FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL', [body.email]);
    const inviter = await one<{ display_name: string }>('SELECT display_name FROM users WHERE id = $1', [auth.user.id]);
    const workspace = await one<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [id]);
    let invitation: { id: string; created_at: Date; expires_at: Date } | null;
    try {
      invitation = await one<{ id: string; created_at: Date; expires_at: Date }>(
        `INSERT INTO workspace_invitations (workspace_id, inviter_id, email, invitee_id, role, token_hash, token_cipher, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '14 days')
         RETURNING id, created_at, expires_at`,
        [id, auth.user.id, body.email, invitee?.id ?? null, body.role, sha256(token), 'pending-cipher'],
      );
    } catch (error) {
      // A parallel request won the unique pending-invitation index.
      if ((error as { code?: string }).code === '23505') throw errors.conflict('已经向这个邮箱发送过邀请');
      throw error;
    }
    const cipher = encryptString(token, `invite:${invitation!.id}`);
    await one('UPDATE workspace_invitations SET token_cipher = $2 WHERE id = $1 RETURNING id', [invitation!.id, cipher]);
    if (invitee) {
      await notify({
        userId: invitee.id,
        type: 'invitation',
        title: `${inviter?.display_name ?? '有人'} 邀请你加入「${workspace?.name ?? '工作区'}」`,
        titleEn: `${inviter?.display_name ?? 'Someone'} invited you to “${workspace?.name ?? 'Workspace'}”`,
        body: `角色：${body.role}`,
        bodyEn: `Role: ${body.role}`,
        link: `/invite/${token}`,
      });
    }
    await audit({ workspaceId: id, actorId: auth.user.id, action: 'member.invite', targetType: 'email', targetId: body.email, meta: { role: body.role }, ip: clientIp(request) });
    let emailSent = false;
    if (mailEnabled()) {
      try {
        await sendWorkspaceInviteEmail({
          to: body.email,
          inviterName: inviter?.display_name ?? (request.headers['accept-language']?.startsWith('en') ? 'Someone' : '有人'),
          workspaceName: workspace?.name ?? 'Workspace',
          role: body.role,
          url: inviteUrl(token, request),
          locale: normalizeLocale(request.headers['accept-language']),
        });
        emailSent = true;
        await audit({ workspaceId: id, actorId: auth.user.id, action: 'mail.invite.sent', targetType: 'email', targetId: body.email, meta: { ok: true }, ip: clientIp(request) });
      } catch (error) {
        app.log.warn({ error, workspaceId: id }, 'failed to send workspace invitation email');
        await audit({ workspaceId: id, actorId: auth.user.id, action: 'mail.invite.failed', targetType: 'email', targetId: body.email, meta: { ok: false, error: (error as Error).message.slice(0, 500) }, ip: clientIp(request) });
      }
    }
    return {
      invitation: {
        id: invitation!.id,
        workspaceId: id,
        email: body.email,
        role: body.role,
        status: 'pending',
        createdAt: invitation!.created_at.toISOString(),
        expiresAt: invitation!.expires_at.toISOString(),
        url: inviteUrl(token, request),
      },
      emailSent,
    };
  });

  app.delete('/api/workspaces/:id/invitations/:invitationId', async (request) => {
    const auth = requireAuth(request);
    const { id, invitationId } = parse(
      z.object({ id: z.string().uuid(), invitationId: z.string().uuid() }),
      request.params,
    );
    await requireWorkspace(auth.user.id, id, 'manage');
    await rejectVaultMembers(id);
    await one(`UPDATE workspace_invitations SET status = 'revoked' WHERE id = $1 AND workspace_id = $2 RETURNING id`, [invitationId, id]);
    return { ok: true };
  });

  app.get('/api/invitations', async (request) => {
    const auth = requireAuth(request);
    const rows = await many<{
      id: string;
      workspace_id: string;
      workspace_name: string;
      email: string;
      role: string;
      status: string;
      created_at: Date;
      expires_at: Date;
      token_cipher: string;
      inviter_name: string | null;
    }>(
      `SELECT i.*, w.name AS workspace_name, u.display_name AS inviter_name
       FROM workspace_invitations i
       JOIN workspaces w ON w.id = i.workspace_id
       LEFT JOIN users u ON u.id = i.inviter_id
       WHERE i.status = 'pending' AND i.expires_at > now()
         AND (i.invitee_id = $2 OR (i.invitee_id IS NULL AND lower(i.email) = lower($1)))
       ORDER BY i.created_at DESC`,
      [auth.user.email, auth.user.id],
    );
    return {
      invitations: rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        email: row.email,
        role: row.role,
        status: row.status,
        inviterName: row.inviter_name ?? undefined,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        token: decryptString(row.token_cipher, `invite:${row.id}`),
      })),
    };
  });

  app.post('/api/invitations/:token/accept', async (request) => {
    const auth = requireAuth(request);
    const { token } = parse(z.object({ token: z.string().min(10) }), request.params);
    const row = await one<{
      id: string;
      workspace_id: string;
      email: string;
      role: string;
      status: string;
      expires_at: Date;
      inviter_id: string;
      invitee_id: string | null;
      workspace_name: string;
    }>(
      `SELECT i.id, i.workspace_id, i.email, i.role, i.status, i.expires_at, i.inviter_id, i.invitee_id, w.name AS workspace_name
       FROM workspace_invitations i JOIN workspaces w ON w.id = i.workspace_id
       WHERE i.token_hash = $1`,
      [sha256(token)],
    );
    if (!row || row.status !== 'pending') throw errors.notFound('邀请不存在或已失效');
    if (row.expires_at < new Date()) throw errors.badRequest('邀请已过期');
    // A known invitee is bound by user id so a changed email cannot transfer the
    // invitation; email matching is only for addresses without an account yet.
    const belongsToUser = row.invitee_id ? row.invitee_id === auth.user.id : row.email.toLowerCase() === auth.user.email.toLowerCase();
    if (!belongsToUser) throw errors.forbidden('这个邀请属于另一个账号');
    await transaction(async (client) => {
      // Only one concurrent accept may consume a pending, unexpired invitation.
      const accepted = await client.query<{ id: string }>(
        `UPDATE workspace_invitations SET status = 'accepted', accepted_at = now()
         WHERE id = $1 AND status = 'pending' AND expires_at > now()
         RETURNING id`,
        [row.id],
      );
      if (accepted.rowCount !== 1) throw errors.notFound('邀请不存在或已失效');
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [row.workspace_id, auth.user.id, row.role],
      );
      await client.query(
        `INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1, 'invitation', $2, $3, '/app')`,
        [row.inviter_id, `${auth.user.display_name} 接受了加入「${row.workspace_name}」的邀请`, null],
      );
    });
    await audit({
      workspaceId: row.workspace_id,
      actorId: auth.user.id,
      action: 'invitation.accept',
      targetType: 'invitation',
      targetId: row.id,
      ip: clientIp(request),
    });
    await query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND type = 'invitation' AND link LIKE $2`, [
      auth.user.id,
      `%${token}%`,
    ]);
    return { workspaceId: row.workspace_id, workspaceName: row.workspace_name };
  });

  app.post('/api/invitations/:token/decline', async (request) => {
    const auth = requireAuth(request);
    const { token } = parse(z.object({ token: z.string().min(10) }), request.params);
    const row = await one<{ id: string; email: string; expires_at: Date; invitee_id: string | null }>(
      `SELECT id, email, expires_at, invitee_id FROM workspace_invitations WHERE token_hash = $1`,
      [sha256(token)],
    );
    if (!row) throw errors.notFound('邀请不存在或已失效');
    const belongsToUser = row.invitee_id ? row.invitee_id === auth.user.id : row.email.toLowerCase() === auth.user.email.toLowerCase();
    if (!belongsToUser) throw errors.forbidden();
    const declined = await one<{ id: string }>(
      `UPDATE workspace_invitations SET status = 'declined'
       WHERE id = $1 AND status = 'pending' AND expires_at > now() RETURNING id`,
      [row.id],
    );
    if (!declined) throw errors.notFound('邀请不存在或已失效');
    return { ok: true };
  });

  app.get('/api/workspaces/:id/audit', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await requireWorkspace(auth.user.id, id, 'manage');
    const queryParams = parse(
      z.object({ limit: z.coerce.number().min(1).max(200).default(80), before: z.string().optional() }),
      request.query,
    );
    const rows = await many<{
      id: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      meta: Record<string, unknown> | null;
      ip: string | null;
      created_at: Date;
      actor_name: string | null;
    }>(
      `SELECT a.*, u.display_name AS actor_name FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.workspace_id = $1 ${queryParams.before ? 'AND a.created_at < $3' : ''}
       ORDER BY a.created_at DESC LIMIT $2`,
      queryParams.before ? [id, queryParams.limit, queryParams.before] : [id, queryParams.limit],
    );
    return {
      entries: rows.map((row) => ({
        id: Number(row.id),
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        meta: row.meta,
        ip: row.ip,
        actorName: row.actor_name,
        createdAt: row.created_at.toISOString(),
      })),
    };
  });

  app.get('/api/workspaces/:id/summary', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const role = await requireWorkspace(auth.user.id, id, 'read');
    const noteCount = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM notes WHERE workspace_id = $1 AND trashed_at IS NULL AND deleted_at IS NULL`,
      [id],
    );
    const attachmentSize = await one<{ size: string }>(
      `SELECT COALESCE(sum(size_bytes), 0)::text AS size FROM attachments WHERE workspace_id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return {
      role,
      memberCount: await workspaceMemberCount(id),
      noteCount: Number(noteCount?.count ?? 0),
      attachmentBytes: Number(attachmentSize?.size ?? 0),
      avatarColor: avatarColor(id),
    };
  });
}
