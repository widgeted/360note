import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { clientIp, requireAuth } from '../auth.js';
import { audit } from '../lib/audit.js';
import { AppError, errors } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { getAiConfig, getSetting, saveAiConfig, setSetting } from '../services/settings.js';
import { config } from '../config.js';
import { getOffsiteConfig, offsitePublicConfig, saveOffsiteConfig, testOffsite } from '../services/offsite.js';
import { getNoteForUser } from '../services/notes.js';
import { readBackup } from '../lib/storage.js';
import { decryptString, sha256 } from '../lib/crypto.js';
import { createInstanceBackup, deleteInstanceBackup, downloadInstanceBackup, getInstanceBackupSettings, listInstanceBackups, saveInstanceBackupSettings, uploadInstanceBackupToOffsite } from '../services/instance-backups.js';
import { attachmentMigrationRunning, getAttachmentStorageUsage, getLocalAttachmentUsage, startDisableAttachments, startEnableAttachments } from '../services/attachment-storage.js';

export default async function adminRoutes(app: FastifyInstance) {
  async function requireAdmin(userId: string): Promise<void> {
    const row = await one<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
    if (row?.role !== 'admin') throw errors.forbidden('需要实例管理员权限');
  }

  app.get('/api/admin/stats', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const stats = await one<{
      users: string;
      workspaces: string;
      notes: string;
      attachments: string;
      bytes: string;
      shares: string;
      sessions: string;
      pending_jobs: string;
      failed_jobs: string;
      database_bytes: string;
      last_backup: Date | null;
    }>(
      `SELECT
        (SELECT count(*)::text FROM users WHERE deleted_at IS NULL) AS users,
        (SELECT count(*)::text FROM workspaces WHERE deleted_at IS NULL) AS workspaces,
        (SELECT count(*)::text FROM notes WHERE deleted_at IS NULL AND trashed_at IS NULL) AS notes,
        (SELECT count(*)::text FROM attachments WHERE deleted_at IS NULL) AS attachments,
        (SELECT COALESCE(sum(size_bytes),0)::text FROM attachments WHERE deleted_at IS NULL) AS bytes,
        (SELECT count(*)::text FROM share_links WHERE revoked_at IS NULL) AS shares,
        (SELECT count(*)::text FROM sessions WHERE revoked_at IS NULL AND expires_at > now()) AS sessions,
        (SELECT count(*)::text FROM jobs WHERE status IN ('queued', 'running')) AS pending_jobs,
        (SELECT count(*)::text FROM jobs WHERE status = 'error' AND created_at > now() - interval '24 hours') AS failed_jobs,
        pg_database_size(current_database())::text AS database_bytes,
        (SELECT max(created_at) FROM backups) AS last_backup`,
    );
    const [localUsage, attachmentMeta, offsiteConfig] = await Promise.all([
      getLocalAttachmentUsage().catch(() => ({ files: 0, bytes: 0 })),
      one<{ local_rows: string; remote_rows: string }>(
        `SELECT
          count(*) FILTER (WHERE storage_key NOT LIKE 's3:%')::text AS local_rows,
          count(*) FILTER (WHERE storage_key LIKE 's3:%')::text AS remote_rows
         FROM attachments WHERE deleted_at IS NULL`,
      ),
      getOffsiteConfig(),
    ]);
    return {
      stats: {
        users: Number(stats!.users),
        workspaces: Number(stats!.workspaces),
        notes: Number(stats!.notes),
        attachments: Number(stats!.attachments),
        storageBytes: Number(stats!.bytes),
        activeShares: Number(stats!.shares),
        activeSessions: Number(stats!.sessions),
        pendingJobs: Number(stats!.pending_jobs),
        failedJobs: Number(stats!.failed_jobs),
        databaseBytes: Number(stats!.database_bytes),
        lastBackupAt: stats!.last_backup?.toISOString() ?? null,
      },
      runtime: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryBytes: process.memoryUsage().rss,
        nodeVersion: process.version,
      },
      instance: {
        version: config.version,
        registrationMode: config.registrationMode,
        aiEnabled: (await getAiConfig()).enabled,
        ocrEnabled: config.ocrEnabled,
        backupRetentionDays: config.backupRetentionDays,
      },
      attachmentStorage: {
        localBytes: localUsage.bytes,
        localFiles: localUsage.files,
        localAttachments: Number(attachmentMeta?.local_rows ?? 0),
        remoteAttachments: Number(attachmentMeta?.remote_rows ?? 0),
        attachmentsEnabled: offsiteConfig.attachmentsEnabled,
        offsiteEnabled: offsiteConfig.enabled,
      },
    };
  });

  app.get('/api/admin/users', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const rows = await many<{
      id: string;
      email: string;
      display_name: string;
      role: string;
      totp_enabled: boolean;
      last_login_at: Date | null;
      created_at: Date;
      workspace_count: string;
      note_count: string;
      storage_bytes: string;
      session_count: string;
      sharing_disabled: boolean;
      disabled_at: Date | null;
    }>(
      `SELECT u.id, u.email, u.display_name, u.role, u.totp_enabled, u.last_login_at, u.created_at,
        u.sharing_disabled, u.disabled_at,
        (SELECT count(*) FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.user_id = u.id AND w.deleted_at IS NULL)::text AS workspace_count,
        (SELECT count(*) FROM notes n JOIN workspace_members m ON m.workspace_id = n.workspace_id
          WHERE m.user_id = u.id AND n.deleted_at IS NULL AND n.trashed_at IS NULL)::text AS note_count,
        (SELECT COALESCE(sum(a.size_bytes),0) FROM attachments a JOIN workspace_members m ON m.workspace_id = a.workspace_id
          WHERE m.user_id = u.id AND a.deleted_at IS NULL)::text AS storage_bytes,
        (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now())::text AS session_count
       FROM users u WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC LIMIT 500`,
    );
    return {
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        totpEnabled: row.totp_enabled,
        lastLoginAt: row.last_login_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        workspaceCount: Number(row.workspace_count),
        noteCount: Number(row.note_count),
        storageBytes: Number(row.storage_bytes),
        sessionCount: Number(row.session_count),
        sharingDisabled: row.sharing_disabled,
        disabledAt: row.disabled_at?.toISOString() ?? null,
      })),
    };
  });

  app.patch('/api/admin/users/:id/role', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(z.object({ role: z.enum(['user', 'admin']) }), request.body);
    if (id === auth.user.id && body.role !== 'admin') throw errors.badRequest('不能移除自己的管理员权限');
    if (body.role === 'user') {
      const admins = await one<{ count: string }>(
        `SELECT count(*)::text AS count FROM users WHERE role = 'admin' AND deleted_at IS NULL`,
      );
      if (Number(admins?.count ?? 0) <= 1) throw errors.badRequest('实例至少需要保留一个管理员');
    }
    const updated = await one<{ id: string }>(
      'UPDATE users SET role = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
      [id, body.role],
    );
    if (!updated) throw errors.notFound('用户不存在');
    await audit({ actorId: auth.user.id, action: 'admin.user.role', targetType: 'user', targetId: id, meta: { role: body.role }, ip: clientIp(request) });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/revoke-sessions', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    if (id === auth.user.id) throw errors.badRequest('请在账户安全页退出自己的其他设备');
    await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await audit({ actorId: auth.user.id, action: 'admin.user.sessions', targetType: 'user', targetId: id, ip: clientIp(request) });
    return { ok: true };
  });

  app.patch('/api/admin/users/:id/restrictions', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(
      z.object({
        sharingDisabled: z.boolean().optional(),
        disabled: z.boolean().optional(),
      }),
      request.body,
    );
    if (id === auth.user.id && body.disabled) throw errors.badRequest('不能停用自己的管理员账户');
    const user = await one<{ id: string }>('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!user) throw errors.notFound('用户不存在');
    if (body.sharingDisabled !== undefined) {
      await query('UPDATE users SET sharing_disabled = $2, updated_at = now() WHERE id = $1', [id, body.sharingDisabled]);
      if (body.sharingDisabled) {
        await query('UPDATE share_links SET revoked_at = now() WHERE created_by = $1 AND revoked_at IS NULL', [id]);
      }
    }
    if (body.disabled !== undefined) {
      await query('UPDATE users SET disabled_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now() WHERE id = $1', [id, body.disabled]);
      if (body.disabled) {
        await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
        await query('UPDATE share_links SET revoked_at = now() WHERE created_by = $1 AND revoked_at IS NULL', [id]);
      }
    }
    await audit({ actorId: auth.user.id, action: 'admin.user.restrictions', targetType: 'user', targetId: id, meta: body, ip: clientIp(request) });
    return { ok: true };
  });

  app.get('/api/admin/ip-blocks', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const rows = await many<{ id: string; ip: string; reason: string | null; created_at: Date }>(
      'SELECT id, ip, reason, created_at FROM registration_ip_blocks ORDER BY created_at DESC LIMIT 500',
    );
    return {
      blocks: rows.map((row) => ({ id: row.id, ip: row.ip, reason: row.reason, createdAt: row.created_at.toISOString() })),
    };
  });

  app.post('/api/admin/ip-blocks', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const body = parse(z.object({ ip: z.string().trim().min(3).max(64), reason: z.string().trim().max(200).optional() }), request.body);
    const row = await one<{ id: string }>(
      `INSERT INTO registration_ip_blocks (ip, reason, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason RETURNING id`,
      [body.ip, body.reason ?? null, auth.user.id],
    );
    await audit({ actorId: auth.user.id, action: 'admin.ip.block', targetType: 'ip', targetId: body.ip, meta: { reason: body.reason ?? null }, ip: clientIp(request) });
    return { id: row!.id };
  });

  app.delete('/api/admin/ip-blocks/:id', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await query('DELETE FROM registration_ip_blocks WHERE id = $1', [id]);
    await audit({ actorId: auth.user.id, action: 'admin.ip.unblock', targetType: 'ip', targetId: id, ip: clientIp(request) });
    return { ok: true };
  });

  app.get('/api/user-exports/:token', async (request, reply) => {
    const { token } = parse(z.object({ token: z.string().min(20) }), request.params);
    const row = await one<{ id: string; filename: string; expires_at: Date }>(
      'SELECT id, filename, expires_at FROM user_export_links WHERE token_hash = $1',
      [sha256(token)],
    );
    if (!row || row.expires_at < new Date()) throw errors.notFound('下载链接不存在或已过期');
    const data = await readBackup(row.filename);
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.filename.replace(/\.(nhbackup|3nb)$/, '.3nb'))}`)
      .header('Cache-Control', 'no-store')
      .send(data);
  });

  app.get('/api/admin/shares', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const rows = await many<{
      id: string;
      token_cipher: string;
      permission: string;
      password_hash: string | null;
      expires_at: Date | null;
      created_at: Date;
      view_count: number;
      workspace_name: string;
      owner_name: string | null;
    }>(
      `SELECT s.id, s.token_cipher, s.permission, s.password_hash, s.expires_at, s.created_at, s.view_count,
        w.name AS workspace_name, u.display_name AS owner_name
       FROM share_links s
       JOIN notes n ON n.id = s.note_id
       JOIN workspaces w ON w.id = n.workspace_id
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now())
         AND n.deleted_at IS NULL AND n.trashed_at IS NULL AND w.deleted_at IS NULL
       ORDER BY s.created_at DESC LIMIT 200`,
    );
    return {
      shares: rows.map((row) => ({
        id: row.id,
        workspaceName: row.workspace_name,
        ownerName: row.owner_name,
        permission: row.permission,
        hasPassword: Boolean(row.password_hash),
        expiresAt: row.expires_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        viewCount: row.view_count,
        url: `${config.publicOrigin}/s/${decryptString(row.token_cipher, `share:${row.id}`)}`,
      })),
    };
  });

  app.get('/api/admin/instance-backups', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const rows = await listInstanceBackups();
    return {
      backups: rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        size: Number(row.size_bytes),
        status: row.status,
        offsiteStatus: row.offsite_status,
        offsiteError: row.offsite_error,
        createdAt: row.created_at.toISOString(),
      })),
      settings: await getInstanceBackupSettings(),
    };
  });

  app.post('/api/admin/instance-backups', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const backup = await createInstanceBackup(auth.user.id);
    await audit({ actorId: auth.user.id, action: 'admin.instance_backup.create', targetType: 'instance_backup', targetId: backup.id, meta: { size: backup.size }, ip: clientIp(request) });
    return { backup };
  });

  app.post('/api/admin/instance-backups/:id/upload', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const status = await uploadInstanceBackupToOffsite(id);
    if (status === 'failed') throw new AppError(502, 'INSTANCE_BACKUP_UPLOAD_FAILED', '对象存储上传失败，请查看连接状态');
    await audit({ actorId: auth.user.id, action: 'admin.instance_backup.upload', targetType: 'instance_backup', targetId: id, meta: { status }, ip: clientIp(request) });
    return { status };
  });

  app.get('/api/admin/instance-backups/:id/download', async (request, reply) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const row = await one<{ filename: string }>('SELECT filename FROM instance_backups WHERE id = $1', [id]);
    if (!row) throw errors.notFound('实例备份不存在');
    const data = await downloadInstanceBackup(row.filename);
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`)
      .header('Cache-Control', 'no-store')
      .send(data);
  });

  app.delete('/api/admin/instance-backups/:id', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await deleteInstanceBackup(id);
    await audit({ actorId: auth.user.id, action: 'admin.instance_backup.delete', targetType: 'instance_backup', targetId: id, ip: clientIp(request) });
    return { ok: true };
  });

  app.get('/api/admin/settings', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const ai = await getAiConfig();
    const backup = await getSetting<{ retentionDays?: number; offsite?: Record<string, unknown> }>('backup');
    return {
      ai: {
        enabled: ai.enabled,
        baseUrl: ai.baseUrl,
        model: ai.model,
        providerLabel: ai.providerLabel,
        hasApiKey: Boolean(ai.apiKey),
      },
      backup: {
        retentionDays: backup?.retentionDays ?? config.backupRetentionDays,
        offsite: backup?.offsite ?? { enabled: false },
      },
      registration: { mode: config.registrationMode },
      instanceBackup: await getInstanceBackupSettings(),
      environment: {
        publicOrigin: config.publicOrigin,
        version: config.version,
        ocrEnabled: config.ocrEnabled,
      },
    };
  });

  app.put('/api/admin/settings', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const body = parse(
      z.object({
        ai: z
          .object({
            enabled: z.boolean(),
            baseUrl: z.string().url().or(z.literal('')),
            model: z.string().max(120),
            apiKey: z.string().max(500).optional(),
            providerLabel: z.string().max(80).optional(),
          })
          .optional(),
        backup: z
          .object({
            retentionDays: z.number().int().min(1).max(3650).optional(),
            offsite: z.record(z.string(), z.unknown()).optional(),
          })
          .optional(),
        instanceBackup: z
          .object({
            enabled: z.boolean().optional(),
            frequencyHours: z.number().int().min(1).max(720).optional(),
            retentionCount: z.number().int().min(1).max(365).optional(),
          })
          .optional(),
      }),
      request.body,
    );
    if (body.ai) {
      if (body.ai.enabled && (!body.ai.baseUrl || !body.ai.model)) {
        throw errors.badRequest('开启 AI 前需要填写接口地址和模型名称');
      }
      await saveAiConfig(body.ai);
    }
    if (body.backup) {
      const existing = (await getSetting<Record<string, unknown>>('backup')) ?? {};
      await setSetting('backup', {
        ...existing,
        ...(body.backup.retentionDays ? { retentionDays: body.backup.retentionDays } : {}),
        ...(body.backup.offsite ? { offsite: body.backup.offsite } : {}),
      });
    }
    if (body.instanceBackup) await saveInstanceBackupSettings(body.instanceBackup);
    await audit({ actorId: auth.user.id, action: 'admin.settings.update', meta: { ai: Boolean(body.ai), backup: Boolean(body.backup) }, ip: clientIp(request) });
    return { ok: true };
  });

  app.get('/api/admin/offsite', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    return { offsite: await offsitePublicConfig() };
  });

  app.put('/api/admin/offsite', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const body = parse(
      z.object({
        enabled: z.boolean(),
        endpoint: z.string().url().or(z.literal('')),
        region: z.string().max(80),
        bucket: z.string().max(200),
        prefix: z.string().max(200),
        accessKeyId: z.string().max(300),
        secretAccessKey: z.string().max(500).optional(),
        forcePathStyle: z.boolean().optional(),
      }),
      request.body,
    );
    if (body.enabled && (!body.endpoint || !body.bucket || !body.accessKeyId)) {
      throw errors.badRequest('启用异地备份需要填写 endpoint、bucket、accessKeyId');
    }
    if (attachmentMigrationRunning()) throw errors.conflict('附件迁移正在进行，暂不能修改对象存储连接');
    const current = await getOffsiteConfig();
    const stored = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM attachments WHERE deleted_at IS NULL AND storage_key LIKE 's3:%'`,
    );
    const hasRemoteAttachments = Number(stored?.count ?? 0) > 0 || current.attachmentsEnabled;
    const identityChanged =
      body.endpoint !== current.endpoint ||
      body.bucket !== current.bucket ||
      body.prefix !== current.prefix ||
      body.accessKeyId !== current.accessKeyId ||
      (body.secretAccessKey ? body.secretAccessKey !== current.secretAccessKey : false) ||
      (body.forcePathStyle ?? current.forcePathStyle) !== current.forcePathStyle;
    if (hasRemoteAttachments && identityChanged) {
      throw errors.badRequest('已有附件保存在对象存储中。请先停用并取回全部附件，再修改连接配置。');
    }
    await saveOffsiteConfig(body);
    await audit({ actorId: auth.user.id, action: 'admin.offsite.update', meta: { enabled: body.enabled, bucket: body.bucket }, ip: clientIp(request) });
    return { offsite: await offsitePublicConfig() };
  });

  app.post('/api/admin/offsite/test', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const configValue = await getOffsiteConfig();
    try {
      await testOffsite(configValue);
      return { ok: true };
    } catch (error) {
      throw new AppError(502, 'OFFSITE_TEST_FAILED', (error as Error).message.slice(0, 300));
    }
  });

  app.get('/api/admin/offsite/usage', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const { force } = parse(z.object({ force: z.enum(['0', '1']).optional() }), request.query);
    return await getAttachmentStorageUsage(force === '1');
  });

  app.post('/api/admin/offsite/attachments/enable', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const state = await startEnableAttachments();
    await audit({ actorId: auth.user.id, action: 'admin.offsite.attachments.enable', ip: clientIp(request) });
    return { migration: state };
  });

  app.post('/api/admin/offsite/attachments/disable', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const body = parse(z.object({ purgeRemote: z.boolean().optional() }), request.body ?? {});
    const state = await startDisableAttachments(Boolean(body.purgeRemote));
    await audit({ actorId: auth.user.id, action: 'admin.offsite.attachments.disable', meta: { purgeRemote: Boolean(body.purgeRemote) }, ip: clientIp(request) });
    return { migration: state };
  });

  app.get('/api/admin/audit', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
    const params = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
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
      workspace_name: string | null;
    }>(
      `SELECT a.*, u.display_name AS actor_name, w.name AS workspace_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN workspaces w ON w.id = a.workspace_id
       ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
      [params.limit, params.offset],
    );
    const total = await one<{ count: string }>('SELECT count(*)::text AS count FROM audit_logs');
    return {
      total: Number(total?.count ?? 0),
      limit: params.limit,
      offset: params.offset,
      entries: rows.map((row) => ({
        id: Number(row.id),
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        meta: row.meta,
        ip: row.ip,
        actorName: row.actor_name,
        workspaceName: row.workspace_name,
        createdAt: row.created_at.toISOString(),
      })),
    };
  });

  app.post('/api/ai/summarize', {
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request) => {
    const auth = requireAuth(request);
    const body = parse(z.object({ noteId: z.string().uuid(), locale: z.string().max(10).optional() }), request.body);
    const { note } = await getNoteForUser(body.noteId, auth.user.id);
    if (note.encrypted) throw errors.badRequest('加密笔记不能使用 AI 摘要');
    const ai = await getAiConfig();
    if (!ai.enabled || !ai.baseUrl || !ai.apiKey || !ai.model) {
      throw new AppError(501, 'AI_DISABLED', '实例管理员尚未启用 AI');
    }
    const text = note.contentMd.slice(0, 30_000);
    const locale = body.locale?.startsWith('en') ? 'English' : '简体中文';
    let response: Response;
    try {
      response = await fetch(`${ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ai.apiKey}`,
        },
        body: JSON.stringify({
          model: ai.model,
          temperature: 0.2,
          max_tokens: 500,
          messages: [
            {
              role: 'system',
              content: `You summarize notes faithfully. Reply in ${locale}. Do not invent facts. Use a short paragraph and 3-5 bullet points. Never mention that you are an AI.`,
            },
            { role: 'user', content: `标题：${note.title}\n\n${text}` },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new AppError(502, 'AI_UPSTREAM_ERROR', '无法连接 AI 服务');
    }
    if (!response.ok) throw new AppError(502, 'AI_UPSTREAM_ERROR', `AI 服务返回 ${response.status}`);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) throw new AppError(502, 'AI_EMPTY', 'AI 没有返回内容');
    return { summary, provider: ai.providerLabel, model: ai.model, warning: '本次请求仅包含你主动选择的这篇笔记。360note 不使用你的笔记训练模型。' };
  });

}
