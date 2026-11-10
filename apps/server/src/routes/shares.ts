import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { many, one, query } from '../db.js';
import { clientIp, requireAuth } from '../auth.js';
import { decryptString, encryptString, randomToken, sha256, signToken, verifyToken } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { getNoteForUser } from '../services/notes.js';
import { updateNote } from '../services/notes.js';
import { notify } from '../services/sessions.js';
import { audit } from '../lib/audit.js';
import { readAttachment, sendFileHeaders } from '../lib/storage.js';
import { ensureAttachmentThumbnail } from '../lib/thumbnails.js';
import { originFromRequest } from '../lib/origin.js';

interface ShareRow {
  id: string;
  note_id: string;
  token_hash: string;
  token_cipher: string;
  permission: 'view' | 'comment' | 'edit';
  password_hash: string | null;
  expires_at: Date | null;
  created_by: string;
  created_at: Date;
  revoked_at: Date | null;
  view_count: number;
  last_accessed_at: Date | null;
}

const SHARE_COOKIE = 'nh_share_access';

function shareUrl(token: string, request: FastifyRequest): string {
  return `${originFromRequest(request)}/s/${token}`;
}

function setShareCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SHARE_COOKIE, token, {
    path: '/api/public',
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    maxAge: 2 * 60 * 60,
  });
}

function accessTokenFrom(request: FastifyRequest): string | null {
  const header = request.headers['x-share-access'];
  if (typeof header === 'string' && header) return header;
  const queryValue = (request.query as Record<string, unknown> | undefined)?.access;
  if (typeof queryValue === 'string' && queryValue) return queryValue;
  return request.cookies[SHARE_COOKIE] ?? null;
}

async function shareByToken(token: string, forUpdate = false): Promise<ShareRow | null> {
  return one<ShareRow>(
    `SELECT * FROM share_links WHERE token_hash = $1 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now()) ${forUpdate ? 'FOR UPDATE' : ''}`,
    [sha256(token)],
  );
}

function sharePasswordFingerprint(share: ShareRow): string {
  return sha256(share.password_hash ?? '');
}

function checkAccess(request: FastifyRequest, share: ShareRow): boolean {
  if (!share.password_hash) return true;
  const raw = accessTokenFrom(request);
  if (!raw) return false;
  const payload = verifyToken<{ sid: string; ph?: string }>(raw);
  // Bind the access cookie to the current password hash: changing or removing
  // the share password invalidates previously issued access tokens.
  return Boolean(
    payload &&
      payload.typ === 'share' &&
      payload.sid === share.id &&
      payload.ph === sharePasswordFingerprint(share),
  );
}

function ensureAccess(request: FastifyRequest, share: ShareRow): void {
  if (!checkAccess(request, share)) throw errors.unauthorized('此分享需要密码');
}

function rewriteAttachmentUrls(content: string, token: string): string {
  return content.replace(
    /(?:https?:\/\/[^\s)"']+)?\/api\/attachments\/([0-9a-fA-F-]{36})\/content/g,
    `/api/public/shares/${token}/attachments/$1`,
  );
}

async function publicAttachments(noteId: string) {
  return many<{
    id: string;
    note_id: string;
    filename: string;
    mime: string;
    size_bytes: string;
    width: number | null;
    height: number | null;
    created_at: Date;
  }>(
    `SELECT id, note_id, filename, mime, size_bytes, width, height, created_at
     FROM attachments WHERE note_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
    [noteId],
  );
}

export default async function shareRoutes(app: FastifyInstance) {
  app.post('/api/notes/:id/shares', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { note } = await getNoteForUser(id, auth.user.id);
    const restrictions = await one<{ sharing_disabled: boolean; disabled_at: Date | null }>(
      'SELECT sharing_disabled, disabled_at FROM users WHERE id = $1',
      [auth.user.id],
    );
    if (restrictions?.sharing_disabled || restrictions?.disabled_at) {
      throw errors.forbidden('分享功能已被管理员停用');
    }
    if (!note.canShare) throw errors.forbidden('没有分享权限');
    if (note.trashedAt) throw errors.badRequest('请先恢复这篇笔记再创建分享');
    if (note.encrypted) throw errors.badRequest('端到端加密笔记不能创建公开分享');
    const body = parse(
      z.object({
        permission: z.enum(['view', 'comment', 'edit']).default('view'),
        password: z.string().min(4).max(100).optional().nullable(),
        expiresAt: z.string().datetime().optional().nullable(),
      }),
      request.body,
    );
    if (body.expiresAt && new Date(body.expiresAt) <= new Date()) throw errors.badRequest('过期时间必须晚于现在');
    // 12 random bytes = 96 bits, rendered as 16 base64url characters. This is
    // short enough to paste comfortably and still infeasible to brute-force.
    const token = randomToken(12);
    const shareId = crypto.randomUUID();
    const passwordHash = body.password ? await hashPassword(body.password) : null;
    await one(
      `INSERT INTO share_links (id, note_id, token_hash, token_cipher, permission, password_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        shareId,
        id,
        sha256(token),
        encryptString(token, `share:${shareId}`),
        body.permission,
        passwordHash,
        body.expiresAt ? new Date(body.expiresAt) : null,
        auth.user.id,
      ],
    );
    await audit({
      workspaceId: note.workspaceId,
      actorId: auth.user.id,
      action: 'share.create',
      targetType: 'note',
      targetId: id,
      meta: { permission: body.permission, password: Boolean(body.password), expiresAt: body.expiresAt ?? null },
      ip: clientIp(request),
    });
    return {
      share: {
        id: shareId,
        noteId: id,
        token,
        url: shareUrl(token, request),
        permission: body.permission,
        hasPassword: Boolean(body.password),
        expiresAt: body.expiresAt ?? null,
        createdAt: new Date().toISOString(),
        revokedAt: null,
        viewCount: 0,
        lastAccessedAt: null,
      },
    };
  });

  app.get('/api/notes/:id/shares', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { note: sharedNote } = await getNoteForUser(id, auth.user.id);
    if (!sharedNote.canShare) throw errors.forbidden('没有分享权限');
    const rows = await many<ShareRow>('SELECT * FROM share_links WHERE note_id = $1 ORDER BY created_at DESC', [id]);
    return {
      shares: rows.map((row) => ({
        id: row.id,
        noteId: row.note_id,
        token: decryptString(row.token_cipher, `share:${row.id}`),
        url: shareUrl(decryptString(row.token_cipher, `share:${row.id}`), request),
        permission: row.permission,
        hasPassword: Boolean(row.password_hash),
        expiresAt: row.expires_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        revokedAt: row.revoked_at?.toISOString() ?? null,
        viewCount: row.view_count,
        lastAccessedAt: row.last_accessed_at?.toISOString() ?? null,
      })),
    };
  });

  app.patch('/api/shares/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const share = await one<ShareRow>('SELECT * FROM share_links WHERE id = $1', [id]);
    if (!share) throw errors.notFound('分享不存在');
    const { note } = await getNoteForUser(share.note_id, auth.user.id);
    if (!note.canShare) throw errors.forbidden();
    const body = parse(
      z.object({
        permission: z.enum(['view', 'comment', 'edit']).optional(),
        password: z.string().min(4).max(100).nullable().optional(),
        expiresAt: z.string().datetime().nullable().optional(),
        revoked: z.boolean().optional(),
      }),
      request.body,
    );
    const passwordHash =
      body.password === undefined ? share.password_hash : body.password ? await hashPassword(body.password) : null;
    await one(
      `UPDATE share_links SET permission = COALESCE($2, permission),
         password_hash = $3,
         expires_at = CASE WHEN $4 THEN $5 ELSE expires_at END,
         revoked_at = CASE WHEN $6 THEN now() ELSE revoked_at END
       WHERE id = $1 RETURNING id`,
      [
        id,
        body.permission ?? null,
        passwordHash,
        body.expiresAt !== undefined,
        body.expiresAt ? new Date(body.expiresAt) : null,
        body.revoked === true,
      ],
    );
    await audit({ workspaceId: note.workspaceId, actorId: auth.user.id, action: 'share.update', targetType: 'share', targetId: id, ip: clientIp(request) });
    return { ok: true };
  });

  app.delete('/api/shares/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const share = await one<ShareRow>('SELECT * FROM share_links WHERE id = $1', [id]);
    if (!share) throw errors.notFound();
    const { note } = await getNoteForUser(share.note_id, auth.user.id);
    if (!note.canShare) throw errors.forbidden();
    await one('UPDATE share_links SET revoked_at = now() WHERE id = $1 RETURNING id', [id]);
    await audit({ workspaceId: note.workspaceId, actorId: auth.user.id, action: 'share.revoke', targetType: 'share', targetId: id, ip: clientIp(request) });
    return { ok: true };
  });

  app.delete('/api/shares/:id/permanent', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const share = await one<ShareRow>('SELECT * FROM share_links WHERE id = $1', [id]);
    if (!share) throw errors.notFound();
    const { note } = await getNoteForUser(share.note_id, auth.user.id);
    if (!note.canShare) throw errors.forbidden();
    if (!share.revoked_at) throw errors.badRequest('请先撤销分享再删除记录');
    await one('DELETE FROM share_links WHERE id = $1 RETURNING id', [id]);
    await audit({ workspaceId: note.workspaceId, actorId: auth.user.id, action: 'share.delete', targetType: 'share', targetId: id, ip: clientIp(request) });
    return { ok: true };
  });

  // ---- Public share endpoints (no account required) ----

  app.post('/api/public/shares/:token/unlock', {
    config: { rateLimit: { max: 8, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const { token } = parse(z.object({ token: z.string().min(8) }), request.params);
    const body = parse(z.object({ password: z.string().max(120) }), request.body);
    const share = await shareByToken(token);
    if (!share) throw errors.notFound('分享链接不存在或已失效');
    if (!share.password_hash) return { ok: true, accessToken: null };
    const ok = await verifyPassword(body.password, share.password_hash);
    if (!ok) throw errors.badRequest('密码不正确');
    const accessToken = signToken(
      { typ: 'share', sid: share.id, ph: sharePasswordFingerprint(share) },
      2 * 60 * 60,
    );
    setShareCookie(reply, accessToken);
    return { ok: true, accessToken };
  });

  app.get('/api/public/shares/:token', async (request, reply) => {
    const { token } = parse(z.object({ token: z.string().min(8) }), request.params);
    const share = await shareByToken(token);
    if (!share) throw errors.notFound('分享链接不存在或已失效');
    const note = await one<{
      id: string;
      title: string;
      content_md: string;
      version: number;
      updated_at: Date;
      encrypted: boolean;
      workspace_id: string;
      created_by: string;
    }>('SELECT id, title, content_md, version, updated_at, encrypted, workspace_id, created_by FROM notes WHERE id = $1 AND deleted_at IS NULL AND trashed_at IS NULL', [share.note_id]);
    if (!note || note.encrypted) throw errors.notFound('笔记不存在');
    const access = checkAccess(request, share);
    if (!access) {
      return reply.header('Cache-Control', 'no-store').send({
        token,
        note: { id: '', title: '', contentMd: '', updatedAt: note.updated_at.toISOString(), version: 0, encrypted: false, attachments: [] },
        permission: share.permission,
        requiresPassword: Boolean(share.password_hash),
        hasAccess: false,
        workspaceName: '',
        expiresAt: share.expires_at?.toISOString() ?? null,
        commentsEnabled: share.permission !== 'view',
        authorName: '',
        publishedAt: share.created_at.toISOString(),
      });
    }
    await query('UPDATE share_links SET view_count = view_count + 1, last_accessed_at = now() WHERE id = $1', [share.id]).catch(() => {});
    const workspace = await one<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [note.workspace_id]);
    const author = await one<{ display_name: string }>('SELECT display_name FROM users WHERE id = $1', [note.created_by]);
    const attachments = await publicAttachments(note.id);
    let comments: unknown[] = [];
    if (share.permission !== 'view') {
      const rows = await many<{
        id: string;
        note_id: string;
        guest_name: string | null;
        body: string;
        resolved: boolean;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, note_id, guest_name, body, resolved, created_at, updated_at
         FROM comments WHERE note_id = $1 AND user_id IS NULL ORDER BY created_at ASC`,
        [note.id],
      );
      comments = rows.map((row) => ({
        id: row.id,
        noteId: row.note_id,
        authorId: null,
        authorName: row.guest_name ?? '访客',
        isGuest: true,
        body: row.body,
        resolved: row.resolved,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      }));
    }
    return reply.header('Cache-Control', 'no-store').send({
      token,
      note: {
        id: note.id,
        title: note.title,
        contentMd: rewriteAttachmentUrls(note.content_md, token),
        updatedAt: note.updated_at.toISOString(),
        version: note.version,
        encrypted: false,
        attachments: attachments.map((row) => ({
          id: row.id,
          noteId: row.note_id,
          filename: row.filename,
          mime: row.mime,
          size: Number(row.size_bytes),
          width: row.width,
          height: row.height,
          ocrStatus: 'none',
          createdAt: row.created_at.toISOString(),
          url: `/api/public/shares/${token}/attachments/${row.id}`,
        })),
      },
      permission: share.permission,
      requiresPassword: Boolean(share.password_hash),
      hasAccess: true,
      workspaceName: workspace?.name ?? '360note',
      expiresAt: share.expires_at?.toISOString() ?? null,
      commentsEnabled: share.permission !== 'view',
      comments,
      authorName: author?.display_name ?? '360note',
      publishedAt: share.created_at.toISOString(),
    });
  });

  app.put('/api/public/shares/:token/note', {
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (request) => {
    const { token } = parse(z.object({ token: z.string().min(8) }), request.params);
    const share = await shareByToken(token);
    if (!share) throw errors.notFound('分享链接不存在或已失效');
    ensureAccess(request, share);
    if (share.permission !== 'edit') throw errors.forbidden('此分享不可编辑');
    const body = parse(
      z.object({
        title: z.string().max(500).optional(),
        contentMd: z.string().max(2_000_000),
        baseVersion: z.number().int().nonnegative(),
        guestName: z.string().max(80).optional(),
      }),
      request.body,
    );
    const note = await one<{ id: string; workspace_id: string; created_by: string; title: string }>(
      'SELECT id, workspace_id, created_by, title FROM notes WHERE id = $1 AND deleted_at IS NULL AND trashed_at IS NULL',
      [share.note_id],
    );
    if (!note) throw errors.notFound('笔记不存在');
    const owner = await one<{ user_id: string }>(
      `SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role = 'owner' LIMIT 1`,
      [note.workspace_id],
    );
    if (!owner) throw errors.internal('工作区没有可用的所有者');
    const canonicalContent = body.contentMd.replace(
      new RegExp(`(?:https?://[^\\s)"']+)?/api/public/shares/${token}/attachments/([0-9a-fA-F-]{36})`, 'g'),
      '/api/attachments/$1/content',
    );
    const result = await updateNote({
      noteId: note.id,
      userId: owner.user_id,
      baseVersion: body.baseVersion,
      title: body.title,
      contentMd: canonicalContent,
      reason: 'auto',
    });
    await audit({ action: 'share.public_edit', targetType: 'note', targetId: note.id, meta: { guestName: body.guestName || '访客' }, ip: clientIp(request) });
    await notify({
      userId: note.created_by,
      type: 'share_edit',
      title: '共享笔记被编辑',
      titleEn: 'Shared note edited',
      body: `${body.guestName || '一位访客'} 通过分享链接更新了《${result.note.title}》（v${result.note.version}）`,
      bodyEn: `${body.guestName || 'A guest'} updated “${result.note.title}” through a share link (v${result.note.version})`,
      link: `/app/note/${note.id}?panel=history&version=${result.note.version}`,
    });
    return { note: { id: result.note.id, title: result.note.title, version: result.note.version, updatedAt: result.note.updatedAt } };
  });

  app.post('/api/public/shares/:token/comments', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request) => {
    const { token } = parse(z.object({ token: z.string().min(8) }), request.params);
    const share = await shareByToken(token);
    if (!share) throw errors.notFound('分享链接不存在或已失效');
    ensureAccess(request, share);
    if (share.permission === 'view') throw errors.forbidden('此分享不可评论');
    const body = parse(
      z.object({ body: z.string().trim().min(1).max(5000), guestName: z.string().trim().max(80).optional() }),
      request.body,
    );
    const note = await one<{ id: string; created_by: string; title: string }>(
      'SELECT id, created_by, title FROM notes WHERE id = $1 AND deleted_at IS NULL AND trashed_at IS NULL',
      [share.note_id],
    );
    if (!note) throw errors.notFound('笔记不存在');
    const row = await one<{ id: string; created_at: Date; updated_at: Date }>(
      `INSERT INTO comments (note_id, guest_name, body, ip) VALUES ($1, $2, $3, $4) RETURNING id, created_at, updated_at`,
      [note.id, body.guestName || '访客', body.body, clientIp(request)],
    );
    await audit({ action: 'share.public_comment', targetType: 'note', targetId: note.id, meta: { guestName: body.guestName || '访客' }, ip: clientIp(request) });
    await notify({
      userId: note.created_by,
      type: 'comment',
      title: '新的分享评论',
      titleEn: 'New share comment',
      body: `${body.guestName || '一位访客'} 评论了《${note.title}》：${body.body.length > 100 ? `${body.body.slice(0, 100)}…` : body.body}`,
      bodyEn: `${body.guestName || 'A guest'} commented on “${note.title}”: ${body.body.length > 100 ? `${body.body.slice(0, 100)}…` : body.body}`,
      link: `/app/note/${note.id}?panel=comments&comment=${row!.id}`,
    });
    return {
      comment: {
        id: row!.id,
        noteId: note.id,
        authorId: null,
        authorName: body.guestName || '访客',
        isGuest: true,
        body: body.body,
        resolved: false,
        createdAt: row!.created_at.toISOString(),
        updatedAt: row!.updated_at.toISOString(),
      },
    };
  });

  app.get('/api/public/shares/:token/attachments/:attachmentId', async (request, reply) => {
    const { token, attachmentId } = parse(
      z.object({ token: z.string().min(8), attachmentId: z.string().uuid() }),
      request.params,
    );
    const { thumb } = parse(z.object({ thumb: z.enum(['0', '1']).optional() }), request.query);
    const share = await shareByToken(token);
    if (!share) throw errors.notFound();
    ensureAccess(request, share);
    const row = await one<{
      filename: string;
      mime: string;
      sha256: string;
      storage_key: string;
    }>(
      `SELECT a.filename, a.mime, a.sha256, a.storage_key
       FROM attachments a JOIN notes n ON n.id = a.note_id
       WHERE a.id = $1 AND a.note_id = $2 AND a.workspace_id = n.workspace_id AND a.deleted_at IS NULL
         AND n.deleted_at IS NULL AND n.trashed_at IS NULL`,
      [attachmentId, share.note_id],
    );
    if (!row) throw errors.notFound();
    let data: Buffer | null = null;
    let responseMime = row.mime;
    let etag = row.sha256;
    if (thumb === '1') {
      const thumbnail = await ensureAttachmentThumbnail(row.storage_key, row.mime);
      if (thumbnail) {
        data = thumbnail;
        responseMime = 'image/webp';
        etag = `${row.sha256}-thumb`;
      }
    }
    if (!data) data = await readAttachment(row.storage_key);
    const ifNone = request.headers['if-none-match'];
    if (ifNone && ifNone.includes(etag)) return reply.status(304).send();
    return reply
      .headers(sendFileHeaders(row.filename, responseMime, etag))
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'")
      .header('Cache-Control', 'private, max-age=86400')
      .send(data);
  });
}
