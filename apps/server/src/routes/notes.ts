import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one } from '../db.js';
import { clientIp, requireAuth } from '../auth.js';
import { audit } from '../lib/audit.js';
import { errors } from '../lib/errors.js';
import { noteContentSchema, noteTitleSchema, parse, uuidSchema } from '../lib/validate.js';
import { snippetFor } from '../lib/text.js';
import { deleteAttachment } from '../lib/storage.js';
import { requireWorkspace } from '../services/workspaces.js';
import {
  createNote,
  getRecentFullNotes,
  deleteNotePermanently,
  duplicateNote,
  emptyTrash,
  getBacklinks,
  getNoteForUser,
  addConflictVersion,
  getVersion,
  listVersions,
  listingNotes,
  mapSummary,
  restoreNote,
  restoreVersion,
  serializeNote,
  trashNote,
  updateLastOpened,
  updateNote,
  getNoteRow,
} from '../services/notes.js';

const listQuery = z.object({
  workspaceId: z.string().uuid(),
  filter: z.enum(['all', 'recent', 'favorites', 'trash', 'folder', 'tag', 'shared']).default('all'),
  folderId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  sort: z.enum(['updated', 'created', 'title', 'opened']).default('updated'),
  q: z.string().max(300).optional(),
  limit: z.coerce.number().min(1).max(100).default(40),
  offset: z.coerce.number().min(0).default(0),
});

async function cleanupFiles(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => deleteAttachment(key).catch(() => {})));
}

export default async function noteRoutes(app: FastifyInstance) {
  app.get('/api/notes', async (request) => {
    const auth = requireAuth(request);
    const params = parse(listQuery, request.query);
    const result = await listingNotes({
      workspaceId: params.workspaceId,
      userId: auth.user.id,
      filter: params.filter,
      folderId: params.folderId,
      tagId: params.tagId,
      sort: params.sort,
      q: params.q,
      limit: params.limit,
      offset: params.offset,
    });
    return { ...result, limit: params.limit, offset: params.offset };
  });

  app.get('/api/search', async (request) => {
    const auth = requireAuth(request);
    const started = Date.now();
    const params = parse(
      listQuery.extend({ q: z.string().max(300).default('') }),
      request.query,
    );
    if (!params.q.trim()) {
      const result = await listingNotes({
        workspaceId: params.workspaceId,
        userId: auth.user.id,
        filter: params.filter,
        folderId: params.folderId,
        tagId: params.tagId,
        sort: params.sort,
        limit: params.limit,
        offset: params.offset,
      });
      return { notes: result.notes, attachments: [], total: result.total, allTotal: result.allTotal, tookMs: Date.now() - started };
    }
    await requireWorkspace(auth.user.id, params.workspaceId, 'read');
    const q = params.q.trim();
    const like = `%${q.replace(/[%_\\]/g, (value) => `\\${value}`)}%`;
    const offset = Math.max(params.offset, 0);
    const limit = Math.min(params.limit, 60);
    const rows = await many<Parameters<typeof mapSummary>[0] & { rank: number }>(
      `SELECT n.*,
        COALESCE((
          SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY lower(t.name))
          FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id
        ), '[]'::json) AS tags,
        (SELECT count(*)::text FROM attachments a WHERE a.note_id = n.id AND a.deleted_at IS NULL) AS attachment_count,
        ts_rank_cd(n.search_vector, websearch_to_tsquery('simple', $2)) AS rank
       FROM notes n
       WHERE n.workspace_id = $1 AND n.deleted_at IS NULL AND n.trashed_at IS NULL
         AND (
           n.search_vector @@ websearch_to_tsquery('simple', $2)
           OR n.title ILIKE $3 ESCAPE '\\'
           OR n.content_md ILIKE $3 ESCAPE '\\'
           OR EXISTS (
             SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
             WHERE nt.note_id = n.id AND t.name ILIKE $3 ESCAPE '\\'
           )
           OR EXISTS (
             SELECT 1 FROM attachments a
             WHERE a.note_id = n.id AND a.deleted_at IS NULL
               AND (a.filename ILIKE $3 ESCAPE '\\' OR a.ocr_text ILIKE $3 ESCAPE '\\')
           )
         )
       ORDER BY rank DESC, n.is_pinned DESC, n.updated_at DESC
       LIMIT $4 OFFSET $5`,
      [params.workspaceId, q, like, limit, offset],
    );
    const countRow = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM notes n
       WHERE n.workspace_id = $1 AND n.deleted_at IS NULL AND n.trashed_at IS NULL
         AND (
           n.search_vector @@ websearch_to_tsquery('simple', $2)
           OR n.title ILIKE $3 ESCAPE '\\'
           OR n.content_md ILIKE $3 ESCAPE '\\'
           OR EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id AND t.name ILIKE $3 ESCAPE '\\')
           OR EXISTS (SELECT 1 FROM attachments a WHERE a.note_id = n.id AND a.deleted_at IS NULL AND (a.filename ILIKE $3 ESCAPE '\\' OR a.ocr_text ILIKE $3 ESCAPE '\\'))
         )`,
      [params.workspaceId, q, like],
    );
    const attachments = await many<{
      id: string;
      note_id: string;
      note_title: string;
      filename: string;
      mime: string;
    }>(
      `SELECT a.id, a.note_id, n.title AS note_title, a.filename, a.mime
       FROM attachments a JOIN notes n ON n.id = a.note_id
       WHERE n.workspace_id = $1 AND n.deleted_at IS NULL AND n.trashed_at IS NULL AND a.deleted_at IS NULL
         AND (a.filename ILIKE $2 ESCAPE '\\' OR a.ocr_text ILIKE $2 ESCAPE '\\')
       ORDER BY a.created_at DESC LIMIT 12`,
      [params.workspaceId, like],
    );
    const allCount = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM notes n
       WHERE n.workspace_id = $1 AND n.deleted_at IS NULL AND n.trashed_at IS NULL`,
      [params.workspaceId],
    );
    return {
      allTotal: Number(allCount?.count ?? 0),
      notes: rows.map((row) => ({
        ...mapSummary(row),
        snippet: snippetFor((row as unknown as { content_md: string }).content_md, q),
      })),
      attachments: attachments.map((row) => ({
        id: row.id,
        noteId: row.note_id,
        noteTitle: row.note_title,
        filename: row.filename,
        mime: row.mime,
      })),
      total: Number(countRow?.count ?? 0),
      tookMs: Date.now() - started,
    };
  });

  app.post('/api/notes', async (request) => {
    const auth = requireAuth(request);
    const body = parse(
      z.object({
        workspaceId: z.string().uuid(),
        title: noteTitleSchema.optional(),
        contentMd: noteContentSchema.optional(),
        folderId: z.string().uuid().nullable().optional(),
        tagIds: z.array(z.string().uuid()).max(50).optional(),
        tagNames: z.array(z.string().max(80)).max(50).optional(),
      }),
      request.body,
    );
    const note = await createNote({
      workspaceId: body.workspaceId,
      userId: auth.user.id,
      title: body.title,
      contentMd: body.contentMd,
      folderId: body.folderId,
      tagIds: body.tagIds,
      tagNames: body.tagNames,
    });
    await audit({ workspaceId: body.workspaceId, actorId: auth.user.id, action: 'note.create', targetType: 'note', targetId: note.id, ip: clientIp(request) });
    return { note };
  });

  app.get('/api/notes/offline-bundle', async (request) => {
    const auth = requireAuth(request);
    const params = parse(z.object({ workspaceId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(300).default(120) }), request.query);
    const notes = await getRecentFullNotes(params.workspaceId, auth.user.id, params.limit);
    return { notes, cachedAt: new Date().toISOString() };
  });

  app.get('/api/notes/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { note } = await getNoteForUser(id, auth.user.id);
    return { note };
  });

  app.patch('/api/notes/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(
      z.object({
        baseVersion: z.number().int().nonnegative().optional(),
        title: noteTitleSchema.optional(),
        contentMd: noteContentSchema.optional(),
        folderId: z.string().uuid().nullable().optional(),
        isFavorite: z.boolean().optional(),
        isPinned: z.boolean().optional(),
        tagIds: z.array(z.string().uuid()).max(50).optional(),
        tagNames: z.array(z.string().max(80)).max(50).optional(),
        reason: z.enum(['auto', 'manual', 'restore', 'import', 'conflict']).optional(),
      }),
      request.body,
    );
    const result = await updateNote({ noteId: id, userId: auth.user.id, ...body });
    return { note: result.note, linkUpdates: result.linkUpdates };
  });

  app.post('/api/notes/:id/open', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await updateLastOpened(id, auth.user.id);
    return { ok: true };
  });

  app.delete('/api/notes/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await trashNote(id, auth.user.id);
    return { ok: true };
  });

  app.post('/api/notes/:id/restore', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return { note: await restoreNote(id, auth.user.id) };
  });

  app.delete('/api/notes/:id/permanent', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const keys = await deleteNotePermanently(id, auth.user.id);
    await cleanupFiles(keys);
    return { ok: true };
  });

  app.post('/api/notes/empty-trash', async (request) => {
    const auth = requireAuth(request);
    const body = parse(z.object({ workspaceId: z.string().uuid() }), request.body);
    const keys = await emptyTrash(body.workspaceId, auth.user.id);
    await cleanupFiles(keys);
    await audit({ workspaceId: body.workspaceId, actorId: auth.user.id, action: 'note.empty_trash', ip: clientIp(request) });
    return { ok: true, deletedAttachments: keys.length };
  });

  app.post('/api/notes/:id/duplicate', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return { note: await duplicateNote(id, auth.user.id) };
  });

  app.get('/api/notes/:id/versions', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return listVersions(id, auth.user.id);
  });

  app.get('/api/notes/:id/versions/:versionId', async (request) => {
    const auth = requireAuth(request);
    const { id, versionId } = parse(
      z.object({ id: z.string().uuid(), versionId: z.coerce.number().int().positive() }),
      request.params,
    );
    return { version: await getVersion(id, versionId, auth.user.id) };
  });

  app.post('/api/notes/:id/versions/:versionId/restore', async (request) => {
    const auth = requireAuth(request);
    const { id, versionId } = parse(
      z.object({ id: z.string().uuid(), versionId: z.coerce.number().int().positive() }),
      request.params,
    );
    const note = await restoreVersion(id, versionId, auth.user.id);
    await audit({ workspaceId: note.workspaceId, actorId: auth.user.id, action: 'note.version.restore', targetType: 'note', targetId: id, meta: { version: versionId }, ip: clientIp(request) });
    return { note };
  });

  app.post('/api/notes/:id/conflicts', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(
      z.object({ title: noteTitleSchema, contentMd: noteContentSchema }),
      request.body,
    );
    const result = await addConflictVersion({
      noteId: id,
      userId: auth.user.id,
      title: body.title,
      contentMd: body.contentMd,
    });
    await audit({
      workspaceId: (await getNoteForUser(id, auth.user.id)).note.workspaceId,
      actorId: auth.user.id,
      action: 'note.conflict.save',
      targetType: 'note',
      targetId: id,
      meta: { version: result.version },
      ip: clientIp(request),
    });
    return result;
  });

  app.post('/api/notes/:id/versions', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const row = await getNoteRow(id);
    if (!row) throw errors.notFound();
    const result = await updateNote({ noteId: id, userId: auth.user.id, contentMd: row.content_md, title: row.title, reason: 'manual' });
    return { note: result.note, linkUpdates: result.linkUpdates };
  });

  app.get('/api/notes/:id/backlinks', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return { backlinks: await getBacklinks(id, auth.user.id) };
  });

  app.post('/api/notes/batch', async (request) => {
    const auth = requireAuth(request);
    const body = parse(
      z.object({
        action: z.enum(['trash', 'restore', 'delete', 'favorite', 'unfavorite', 'pin', 'unpin', 'move', 'tag', 'untag']),
        ids: z.array(z.string().uuid()).min(1).max(200),
        folderId: z.string().uuid().nullable().optional(),
        tagId: z.string().uuid().optional(),
      }),
      request.body,
    );
    let affected = 0;
    const fileKeys: string[] = [];
    for (const id of body.ids) {
      try {
        if (body.action === 'trash') {
          await trashNote(id, auth.user.id);
        } else if (body.action === 'restore') {
          await restoreNote(id, auth.user.id);
        } else if (body.action === 'delete') {
          fileKeys.push(...(await deleteNotePermanently(id, auth.user.id)));
        } else if (body.action === 'move') {
          await updateNote({ noteId: id, userId: auth.user.id, folderId: body.folderId ?? null });
        } else if (body.action === 'tag' || body.action === 'untag') {
          const { note } = await getNoteForUser(id, auth.user.id);
          if (!body.tagId) throw errors.badRequest('缺少标签');
          if (body.action === 'tag' && !note.tags.some((tag) => tag.id === body.tagId)) {
            await updateNote({ noteId: id, userId: auth.user.id, tagIds: [...note.tags.map((tag) => tag.id), body.tagId] });
          } else if (body.action === 'untag') {
            await updateNote({ noteId: id, userId: auth.user.id, tagIds: note.tags.filter((tag) => tag.id !== body.tagId).map((tag) => tag.id) });
          }
        } else {
          const favorite = body.action === 'favorite' ? true : body.action === 'unfavorite' ? false : undefined;
          const pinned = body.action === 'pin' ? true : body.action === 'unpin' ? false : undefined;
          await updateNote({ noteId: id, userId: auth.user.id, isFavorite: favorite, isPinned: pinned });
        }
        affected++;
      } catch (error) {
        app.log.warn({ error, noteId: id, action: body.action }, 'batch action skipped');
      }
    }
    await cleanupFiles(fileKeys);
    return { affected };
  });

  app.get('/api/notes/:id/export', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { format } = parse(z.object({ format: z.enum(['md', 'html', 'pdf']).default('md') }), request.query);
    const { note } = await getNoteForUser(id, auth.user.id);
    const { exportSingleNote } = await import('../services/export.js');
    await exportSingleNote(note, format, reply, app);
    return reply;
  });
}
