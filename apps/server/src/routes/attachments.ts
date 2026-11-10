import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { imageSize } from 'image-size';
import { config } from '../config.js';
import { many, one } from '../db.js';
import { requireAuth } from '../auth.js';
import { errors } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { attachmentStorageKey, checksum, deleteAttachment, isDisplayableImage, readAttachment, safeFilename, saveAttachment, sendFileHeaders, sniffMime } from '../lib/storage.js';
import { getNoteForUser } from '../services/notes.js';
import { requireWorkspace } from '../services/workspaces.js';
import { queueOcr } from '../lib/ocr.js';
import { ensureAttachmentThumbnail } from '../lib/thumbnails.js';

export default async function attachmentRoutes(app: FastifyInstance) {
  app.post('/api/notes/:id/attachments', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { note } = await getNoteForUser(id, auth.user.id);
    if (!note.canEdit) throw errors.forbidden('没有编辑权限');
    const part = await request.file({ limits: { fileSize: config.maxUploadBytes, files: 1 } });
    if (!part) throw errors.badRequest('没有上传文件');
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      throw errors.payloadTooLarge(`文件不能超过 ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB`);
    }
    if (!buffer.length) throw errors.badRequest('文件为空');
    const mime = sniffMime(buffer, part.filename, part.mimetype);
    if (/^image\/(heic|heif|tiff|bmp)$/i.test(mime)) {
      throw errors.badRequest('不支持 HEIC/HEIF 等图片格式。请使用 PNG、JPEG、WebP、GIF 或 AVIF。');
    }
    const filename = safeFilename(part.filename);
    let width: number | null = null;
    let height: number | null = null;
    if (mime.startsWith('image/')) {
      try {
        const size = imageSize(buffer);
        width = size.width ?? null;
        height = size.height ?? null;
        if ((width ?? 0) > 12_000 || (height ?? 0) > 12_000) {
          throw errors.badRequest('图片尺寸过大，请压缩后再上传');
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AppError') throw error;
        /* not a decodable image */
      }
    }
    const attachmentId = crypto.randomUUID();
    const localKey = attachmentStorageKey(note.workspaceId, attachmentId);
    const digest = checksum(buffer);
    const storageKey = await saveAttachment(localKey, buffer);
    if (isDisplayableImage(mime)) {
      // Generate before responding so the first render of the inserted image
      // does not race an asynchronous thumbnail upload to object storage.
      const thumbnail = await ensureAttachmentThumbnail(storageKey, mime, buffer);
      if (!thumbnail) app.log.warn({ attachmentId }, 'failed to generate attachment thumbnail');
    }
    const row = await one<{
      id: string;
      note_id: string;
      filename: string;
      mime: string;
      size_bytes: string;
      width: number | null;
      height: number | null;
      created_at: Date;
    }>(
      `INSERT INTO attachments (id, workspace_id, note_id, filename, mime, size_bytes, sha256, storage_key, width, height, created_by, ocr_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, note_id, filename, mime, size_bytes, width, height, created_at`,
      [
        attachmentId,
        note.workspaceId,
        id,
        filename,
        mime,
        buffer.length,
        digest,
        storageKey,
        width,
        height,
        auth.user.id,
        config.ocrEnabled ? 'pending' : 'none',
      ],
    );
    if (config.ocrEnabled) void queueOcr(attachmentId, storageKey, mime, app.log);
    return reply.status(201).send({
      attachment: {
        id: row!.id,
        noteId: row!.note_id,
        filename: row!.filename,
        mime: row!.mime,
        size: Number(row!.size_bytes),
        width: row!.width,
        height: row!.height,
        ocrStatus: config.ocrEnabled ? 'pending' : 'none',
        createdAt: row!.created_at.toISOString(),
        url: `/api/attachments/${row!.id}/content`,
        thumbnailUrl: isDisplayableImage(row!.mime) ? `/api/attachments/${row!.id}/content?thumb=1` : null,
      },
    });
  });

  app.get('/api/attachments/:id/content', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { thumb } = parse(z.object({ thumb: z.enum(['0', '1']).optional() }), request.query);
    const row = await one<{
      id: string;
      workspace_id: string;
      note_id: string;
      filename: string;
      mime: string;
      sha256: string;
      storage_key: string;
      note_trashed: Date | null;
      note_deleted: Date | null;
    }>(
      `SELECT a.id, a.workspace_id, a.note_id, a.filename, a.mime, a.sha256, a.storage_key,
              n.trashed_at AS note_trashed, n.deleted_at AS note_deleted
       FROM attachments a JOIN notes n ON n.id = a.note_id
       WHERE a.id = $1 AND a.deleted_at IS NULL`,
      [id],
    );
    if (!row || row.note_deleted) throw errors.notFound('附件不存在');
    await requireWorkspace(auth.user.id, row.workspace_id, 'read');
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
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('Cache-Control', 'private, max-age=86400')
      .send(data);
  });

  app.get('/api/attachments/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const row = await one<{
      id: string;
      workspace_id: string;
      note_id: string;
      filename: string;
      mime: string;
      size_bytes: string;
      width: number | null;
      height: number | null;
      ocr_status: string;
      created_at: Date;
    }>('SELECT id, workspace_id, note_id, filename, mime, size_bytes, width, height, ocr_status, created_at FROM attachments WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!row) throw errors.notFound('附件不存在');
    await requireWorkspace(auth.user.id, row.workspace_id, 'read');
    return {
      attachment: {
        id: row.id,
        noteId: row.note_id,
        filename: row.filename,
        mime: row.mime,
        size: Number(row.size_bytes),
        width: row.width,
        height: row.height,
        ocrStatus: row.ocr_status,
        createdAt: row.created_at.toISOString(),
      },
    };
  });

  app.delete('/api/attachments/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const row = await one<{ workspace_id: string; note_id: string; storage_key: string }>(
      'SELECT workspace_id, note_id, storage_key FROM attachments WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (!row) throw errors.notFound('附件不存在');
    const { note } = await getNoteForUser(row.note_id, auth.user.id);
    if (!note.canEdit) throw errors.forbidden();
    await one('DELETE FROM attachments WHERE id = $1 RETURNING id', [id]);
    await deleteAttachment(row.storage_key);
    return { ok: true };
  });

  app.get('/api/notes/:id/attachments', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { note } = await getNoteForUser(id, auth.user.id);
    return { attachments: note.attachments };
  });

  app.get('/api/attachments/:id/preview', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const row = await one<{ workspace_id: string; filename: string; mime: string; storage_key: string; sha256: string }>(
      'SELECT workspace_id, filename, mime, storage_key, sha256 FROM attachments WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (!row) throw errors.notFound();
    await requireWorkspace(auth.user.id, row.workspace_id, 'read');
    if (!isDisplayableImage(row.mime)) throw errors.notFound();
    const data = await readAttachment(row.storage_key);
    return reply.headers(sendFileHeaders(row.filename, row.mime, row.sha256)).send(data);
  });
}
