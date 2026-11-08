import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one } from '../db.js';
import { clientIp, requireAuth } from '../auth.js';
import { audit } from '../lib/audit.js';
import { AppError, errors } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { getAiConfig, getSetting, saveAiConfig, setSetting } from '../services/settings.js';
import { config } from '../config.js';
import { getOffsiteConfig, offsitePublicConfig, saveOffsiteConfig, testOffsite } from '../services/offsite.js';
import { getNoteForUser } from '../services/notes.js';

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
    }>(
      `SELECT
        (SELECT count(*)::text FROM users WHERE deleted_at IS NULL) AS users,
        (SELECT count(*)::text FROM workspaces WHERE deleted_at IS NULL) AS workspaces,
        (SELECT count(*)::text FROM notes WHERE deleted_at IS NULL AND trashed_at IS NULL) AS notes,
        (SELECT count(*)::text FROM attachments WHERE deleted_at IS NULL) AS attachments,
        (SELECT COALESCE(sum(size_bytes),0)::text FROM attachments WHERE deleted_at IS NULL) AS bytes,
        (SELECT count(*)::text FROM share_links WHERE revoked_at IS NULL) AS shares`,
    );
    return {
      stats: {
        users: Number(stats!.users),
        workspaces: Number(stats!.workspaces),
        notes: Number(stats!.notes),
        attachments: Number(stats!.attachments),
        storageBytes: Number(stats!.bytes),
        activeShares: Number(stats!.shares),
      },
      instance: {
        version: config.version,
        registrationMode: config.registrationMode,
        aiEnabled: (await getAiConfig()).enabled,
        ocrEnabled: config.ocrEnabled,
        backupRetentionDays: config.backupRetentionDays,
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
    }>(
      `SELECT id, email, display_name, role, totp_enabled, last_login_at, created_at
       FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`,
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
      })),
    };
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

  app.get('/api/admin/audit', async (request) => {
    const auth = requireAuth(request);
    await requireAdmin(auth.user.id);
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
       ORDER BY a.created_at DESC LIMIT 200`,
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
