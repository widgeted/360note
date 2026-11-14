import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, transaction } from '../db.js';
import { requireAuth } from '../auth.js';
import { errors } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireWorkspace } from '../services/workspaces.js';
import { deleteAttachment } from '../lib/storage.js';
import { cleanupNotesMedia } from '../services/media.js';

async function assertNoCycle(folderId: string, parentId: string, workspaceId: string): Promise<void> {
  if (folderId === parentId) throw errors.badRequest('文件夹不能移动到自身');
  let current: string | null = parentId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current === folderId) throw errors.badRequest('文件夹不能移动到自己的子文件夹');
    const row: { parent_id: string | null } | null = await one(
      'SELECT parent_id FROM folders WHERE id = $1 AND workspace_id = $2',
      [current, workspaceId],
    );
    current = row?.parent_id ?? null;
  }
}

export default async function folderRoutes(app: FastifyInstance) {
  app.get('/api/folders', async (request) => {
    const auth = requireAuth(request);
    const { workspaceId } = parse(z.object({ workspaceId: z.string().uuid() }), request.query);
    await requireWorkspace(auth.user.id, workspaceId, 'read');
    const rows = await many<{
      id: string;
      workspace_id: string;
      parent_id: string | null;
      name: string;
      color: string | null;
      icon: string | null;
      position: number;
      trashed_at: Date | null;
      created_at: Date;
      updated_at: Date;
      note_count: string;
    }>(
      `SELECT f.*, (
        SELECT count(*)::text FROM notes n WHERE n.folder_id = f.id AND n.trashed_at IS NULL AND n.deleted_at IS NULL
      ) AS note_count
       FROM folders f WHERE f.workspace_id = $1 AND f.trashed_at IS NULL
       ORDER BY f.position ASC, lower(f.name) ASC`,
      [workspaceId],
    );
    return {
      folders: rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        parentId: row.parent_id,
        name: row.name,
        color: row.color,
        icon: row.icon,
        position: row.position,
        noteCount: Number(row.note_count),
        trashedAt: row.trashed_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  });

  app.get('/api/folders/trash', async (request) => {
    const auth = requireAuth(request);
    const { workspaceId } = parse(z.object({ workspaceId: z.string().uuid() }), request.query);
    await requireWorkspace(auth.user.id, workspaceId, 'read');
    const rows = await many<{ id: string; name: string; parent_id: string | null; trashed_at: Date }>(
      `SELECT id, name, parent_id, trashed_at FROM folders WHERE workspace_id = $1 AND trashed_at IS NOT NULL ORDER BY trashed_at DESC`,
      [workspaceId],
    );
    return {
      folders: rows.map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id, trashedAt: row.trashed_at.toISOString() })),
    };
  });

  app.post('/api/folders', async (request) => {
    const auth = requireAuth(request);
    const body = parse(
      z.object({
        workspaceId: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
        parentId: z.string().uuid().nullable().optional(),
        color: z.string().max(20).optional(),
        icon: z.string().max(40).optional(),
      }),
      request.body,
    );
    await requireWorkspace(auth.user.id, body.workspaceId, 'write');
    if (body.parentId) {
      const parent = await one('SELECT id FROM folders WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL', [
        body.parentId,
        body.workspaceId,
      ]);
      if (!parent) throw errors.badRequest('父文件夹不存在');
    }
    const row = await one<{
      id: string;
      workspace_id: string;
      parent_id: string | null;
      name: string;
      color: string | null;
      icon: string | null;
      position: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO folders (workspace_id, parent_id, name, color, icon, position)
       VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT max(position) + 1 FROM folders WHERE workspace_id = $1 AND parent_id IS NOT DISTINCT FROM $2), 0))
       RETURNING *`,
      [body.workspaceId, body.parentId ?? null, body.name, body.color ?? null, body.icon ?? null],
    );
    return {
      folder: {
        id: row!.id,
        workspaceId: row!.workspace_id,
        parentId: row!.parent_id,
        name: row!.name,
        color: row!.color,
        icon: row!.icon,
        position: row!.position,
        noteCount: 0,
        trashedAt: null,
        createdAt: row!.created_at.toISOString(),
        updatedAt: row!.updated_at.toISOString(),
      },
    };
  });

  app.patch('/api/folders/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const folder = await one<{ workspace_id: string; parent_id: string | null }>('SELECT workspace_id, parent_id FROM folders WHERE id = $1', [id]);
    if (!folder) throw errors.notFound('文件夹不存在');
    await requireWorkspace(auth.user.id, folder.workspace_id, 'write');
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        parentId: z.string().uuid().nullable().optional(),
        color: z.string().max(20).nullable().optional(),
        icon: z.string().max(40).nullable().optional(),
        position: z.number().int().min(0).optional(),
      }),
      request.body,
    );
    if (body.parentId !== undefined && body.parentId) {
      await assertNoCycle(id, body.parentId, folder.workspace_id);
      const parent = await one('SELECT id FROM folders WHERE id = $1 AND workspace_id = $2 AND trashed_at IS NULL', [
        body.parentId,
        folder.workspace_id,
      ]);
      if (!parent) throw errors.badRequest('父文件夹不存在');
    }
    const row = await one<{
      id: string;
      workspace_id: string;
      parent_id: string | null;
      name: string;
      color: string | null;
      icon: string | null;
      position: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE folders SET
         name = COALESCE($2, name),
         parent_id = CASE WHEN $3 THEN $4 ELSE parent_id END,
         color = CASE WHEN $5 THEN $6 ELSE color END,
         icon = CASE WHEN $7 THEN $8 ELSE icon END,
         position = COALESCE($9, position),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        body.name ?? null,
        body.parentId !== undefined,
        body.parentId ?? null,
        body.color !== undefined,
        body.color ?? null,
        body.icon !== undefined,
        body.icon ?? null,
        body.position ?? null,
      ],
    );
    return {
      folder: {
        id: row!.id,
        workspaceId: row!.workspace_id,
        parentId: row!.parent_id,
        name: row!.name,
        color: row!.color,
        icon: row!.icon,
        position: row!.position,
        trashedAt: null,
        createdAt: row!.created_at.toISOString(),
        updatedAt: row!.updated_at.toISOString(),
      },
    };
  });

  app.delete('/api/folders/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const folder = await one<{ workspace_id: string }>('SELECT workspace_id FROM folders WHERE id = $1', [id]);
    if (!folder) throw errors.notFound('文件夹不存在');
    await requireWorkspace(auth.user.id, folder.workspace_id, 'write');
    await transaction(async (client) => {
      await client.query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM folders WHERE id = $1 AND workspace_id = $2
           UNION SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
           WHERE f.workspace_id = $2
         )
         UPDATE folders SET trashed_at = now() WHERE id IN (SELECT id FROM descendants)`,
        [id, folder.workspace_id],
      );
      await client.query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM folders WHERE id = $1 AND workspace_id = $2
           UNION SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
           WHERE f.workspace_id = $2
         )
         UPDATE notes SET trashed_at = now() WHERE folder_id IN (SELECT id FROM descendants) AND trashed_at IS NULL`,
        [id, folder.workspace_id],
      );
    });
    return { ok: true };
  });

  app.post('/api/folders/:id/restore', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const folder = await one<{ workspace_id: string; trashed_at: Date | null }>(
      'SELECT workspace_id, trashed_at FROM folders WHERE id = $1',
      [id],
    );
    if (!folder) throw errors.notFound('文件夹不存在');
    await requireWorkspace(auth.user.id, folder.workspace_id, 'write');
    const trashedAt = folder.trashed_at ?? new Date();
    await transaction(async (client) => {
      // Restore the whole ancestor chain; otherwise a restored child folder is
      // invisible because its parent is still in the trash.
      await client.query(
        `WITH RECURSIVE ancestors AS (
           SELECT id, parent_id FROM folders WHERE id = $1 AND workspace_id = $2
           UNION ALL
           SELECT f.id, f.parent_id FROM folders f JOIN ancestors a ON f.id = a.parent_id
           WHERE f.workspace_id = $2
         )
         UPDATE folders SET trashed_at = NULL WHERE id IN (SELECT id FROM ancestors)`,
        [id, folder.workspace_id],
      );
      // Only restore descendants that were trashed with this folder. A child
      // folder or note deleted separately before the parent must stay deleted.
      await client.query(
        `WITH RECURSIVE descendants AS (
           SELECT id, trashed_at FROM folders WHERE id = $1 AND workspace_id = $2
           UNION SELECT f.id, f.trashed_at FROM folders f JOIN descendants d ON f.parent_id = d.id
           WHERE f.workspace_id = $2
         )
         UPDATE folders SET trashed_at = NULL
         WHERE id IN (SELECT id FROM descendants WHERE id = $1 OR trashed_at >= $3)`,
        [id, folder.workspace_id, trashedAt],
      );
      await client.query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM folders WHERE id = $1 AND workspace_id = $2
           UNION SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
           WHERE f.workspace_id = $2
         )
         UPDATE notes SET trashed_at = NULL
         WHERE folder_id IN (SELECT id FROM descendants)
           AND trashed_at IS NOT NULL AND trashed_at >= $3`,
        [id, folder.workspace_id, trashedAt],
      );
    });
    return { ok: true };
  });

  app.delete('/api/folders/:id/permanent', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const folder = await one<{ workspace_id: string; trashed_at: Date | null }>('SELECT workspace_id, trashed_at FROM folders WHERE id = $1', [id]);
    if (!folder) throw errors.notFound('文件夹不存在');
    await requireWorkspace(auth.user.id, folder.workspace_id, 'write');
    if (!folder.trashed_at) throw errors.badRequest('请先将文件夹移到回收站，再永久删除');
    const keys = await many<{ storage_key: string }>(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM folders WHERE id = $1 AND workspace_id = $2
         UNION SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
         WHERE f.workspace_id = $2
       )
       SELECT a.storage_key FROM attachments a JOIN notes n ON n.id = a.note_id
       WHERE n.folder_id IN (SELECT id FROM descendants)`,
      [id, folder.workspace_id],
    );
    const noteIds = await many<{ id: string }>(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM folders WHERE id = $1 AND workspace_id = $2
         UNION SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
         WHERE f.workspace_id = $2
       )
       SELECT id FROM notes WHERE folder_id IN (SELECT id FROM descendants)`,
      [id, folder.workspace_id],
    );
    await cleanupNotesMedia(noteIds.map((row) => row.id));
    await transaction(async (client) => {
      await client.query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM folders WHERE id = $1 AND workspace_id = $2
           UNION SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
           WHERE f.workspace_id = $2
         )
         DELETE FROM notes WHERE folder_id IN (SELECT id FROM descendants)`,
        [id, folder.workspace_id],
      );
      await client.query('DELETE FROM folders WHERE id = $1', [id]);
    });
    await Promise.all(keys.map((key) => deleteAttachment(key.storage_key).catch(() => {})));
    return { ok: true };
  });
}
