import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one } from '../db.js';
import { requireAuth } from '../auth.js';
import { errors } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { getNoteForUser } from '../services/notes.js';
import { requireWorkspace } from '../services/workspaces.js';
import { audit } from '../lib/audit.js';
import { notify } from '../services/sessions.js';

export default async function commentRoutes(app: FastifyInstance) {
  app.get('/api/notes/:id/comments', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await getNoteForUser(id, auth.user.id);
    const rows = await many<{
      id: string;
      note_id: string;
      user_id: string | null;
      guest_name: string | null;
      body: string;
      resolved: boolean;
      created_at: Date;
      updated_at: Date;
      display_name: string | null;
    }>(
      `SELECT c.*, u.display_name FROM comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.note_id = $1 ORDER BY c.created_at ASC`,
      [id],
    );
    return {
      comments: rows.map((row) => ({
        id: row.id,
        noteId: row.note_id,
        authorId: row.user_id,
        authorName: row.display_name ?? row.guest_name ?? '访客',
        isGuest: !row.user_id,
        body: row.body,
        resolved: row.resolved,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  });

  app.post('/api/notes/:id/comments', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { note } = await getNoteForUser(id, auth.user.id);
    const body = parse(z.object({ body: z.string().trim().min(1).max(5000) }), request.body);
    await requireWorkspace(auth.user.id, note.workspaceId, 'read');
    const row = await one<{ id: string; created_at: Date; updated_at: Date }>(
      `INSERT INTO comments (note_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, created_at, updated_at`,
      [id, auth.user.id, body.body],
    );
    if (note.createdBy !== auth.user.id) {
      await notify({
        userId: note.createdBy,
        type: 'comment',
        title: '新的笔记评论',
        titleEn: 'New note comment',
        body: `${auth.user.display_name} 评论了《${note.title}》：${body.body.length > 100 ? `${body.body.slice(0, 100)}…` : body.body}`,
        bodyEn: `${auth.user.display_name} commented on “${note.title}”: ${body.body.length > 100 ? `${body.body.slice(0, 100)}…` : body.body}`,
        link: `/app/note/${id}?panel=comments&comment=${row!.id}`,
      });
    }
    return {
      comment: {
        id: row!.id,
        noteId: id,
        authorId: auth.user.id,
        authorName: auth.user.display_name,
        isGuest: false,
        body: body.body,
        resolved: false,
        createdAt: row!.created_at.toISOString(),
        updatedAt: row!.updated_at.toISOString(),
      },
    };
  });

  app.patch('/api/comments/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const comment = await one<{ user_id: string | null; note_id: string }>('SELECT user_id, note_id FROM comments WHERE id = $1', [id]);
    if (!comment) throw errors.notFound('评论不存在');
    await getNoteForUser(comment.note_id, auth.user.id);
    if (comment.user_id !== auth.user.id) throw errors.forbidden('只能编辑自己的评论');
    const body = parse(z.object({ body: z.string().trim().min(1).max(5000).optional(), resolved: z.boolean().optional() }), request.body);
    const row = await one<{ id: string; body: string; resolved: boolean; updated_at: Date }>(
      `UPDATE comments SET body = COALESCE($2, body), resolved = COALESCE($3, resolved), updated_at = now()
       WHERE id = $1 RETURNING id, body, resolved, updated_at`,
      [id, body.body ?? null, body.resolved ?? null],
    );
    return { comment: { id: row!.id, body: row!.body, resolved: row!.resolved, updatedAt: row!.updated_at.toISOString() } };
  });

  app.delete('/api/comments/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const comment = await one<{ user_id: string | null; note_id: string }>('SELECT user_id, note_id FROM comments WHERE id = $1', [id]);
    if (!comment) throw errors.notFound('评论不存在');
    await getNoteForUser(comment.note_id, auth.user.id);
    if (comment.user_id !== auth.user.id) throw errors.forbidden('只能删除自己的评论');
    await one('DELETE FROM comments WHERE id = $1 RETURNING id', [id]);
    await audit({ actorId: auth.user.id, action: 'comment.delete', targetType: 'comment', targetId: id });
    return { ok: true };
  });
}
