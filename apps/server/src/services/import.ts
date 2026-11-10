import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { many, one } from '../db.js';
import { createNote, updateNote } from './notes.js';
import { requireWorkspace } from './workspaces.js';
import { attachmentStorageKey, safeFilename, saveAttachment } from '../lib/storage.js';
import { updateJob } from '../lib/jobs.js';
import type { ParsedImport } from '../lib/import-parser.js';

interface FolderNode {
  id: string;
  name: string;
  parent_id: string | null;
}

export async function executeImport(input: {
  jobId: string;
  jobDir: string;
  userId: string;
  workspaceId: string;
  targetFolderId?: string | null;
  parsed: ParsedImport;
}): Promise<Record<string, unknown>> {
  await requireWorkspace(input.userId, input.workspaceId, 'write');
  const folderRows = await many<FolderNode>(
    'SELECT id, name, parent_id FROM folders WHERE workspace_id = $1 AND trashed_at IS NULL',
    [input.workspaceId],
  );
  const folders = new Map<string, FolderNode>();
  const folderIndex = new Map<string, string>();
  for (const row of folderRows) {
    folders.set(row.id, row);
    folderIndex.set(`${row.parent_id ?? 'root'}:${row.name.toLowerCase()}`, row.id);
  }

  async function ensureFolder(parts: string[], parentId: string | null): Promise<string | null> {
    let parent = parentId;
    for (const raw of parts.slice(0, 24)) {
      const name = safeFilename(raw).slice(0, 120);
      if (!name) continue;
      const key = `${parent ?? 'root'}:${name.toLowerCase()}`;
      let id = folderIndex.get(key);
      if (!id) {
        const row = await one<FolderNode>(
          `INSERT INTO folders (workspace_id, parent_id, name) VALUES ($1, $2, $3) RETURNING id, name, parent_id`,
          [input.workspaceId, parent, name],
        );
        id = row!.id;
        folders.set(id, row!);
        folderIndex.set(key, id);
      }
      parent = id;
    }
    return parent;
  }

  const stats = { notes: 0, attachments: 0, skipped: 0 };
  const total = input.parsed.notes.length;
  for (let index = 0; index < input.parsed.notes.length; index++) {
    const parsedNote = input.parsed.notes[index];
    try {
      const folderId = await ensureFolder(parsedNote.folderPath, input.targetFolderId ?? null);
      const note = await createNote({
        workspaceId: input.workspaceId,
        userId: input.userId,
        title: parsedNote.title,
        contentMd: parsedNote.contentMd.replace(/360note-attachment:\/\/[0-9a-f-]{36}/g, ''),
        folderId,
        tagNames: parsedNote.tags,
      });
      stats.notes++;
      let content = parsedNote.contentMd;
      for (const attachment of parsedNote.attachments) {
        try {
          const data = await fs.readFile(path.join(input.jobDir, attachment.storedPath));
          const attachmentId = crypto.randomUUID();
          const localKey = attachmentStorageKey(input.workspaceId, attachmentId);
          const storageKey = await saveAttachment(localKey, data);
          await one(
            `INSERT INTO attachments (id, workspace_id, note_id, filename, mime, size_bytes, sha256, storage_key, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [
              attachmentId,
              input.workspaceId,
              note.id,
              attachment.filename,
              attachment.mime,
              data.length,
              crypto.createHash('sha256').update(data).digest('hex'),
              storageKey,
              input.userId,
            ],
          );
          content = content.replaceAll(`360note-attachment://${attachment.key}`, `/api/attachments/${attachmentId}/content`);
          stats.attachments++;
        } catch (error) {
          input.parsed.warnings.push(`附件 ${attachment.filename} 导入失败`);
        }
      }
      if (content !== note.contentMd) {
        await updateNote({ noteId: note.id, userId: input.userId, contentMd: content, reason: 'import' });
      }
    } catch (error) {
      console.error('[import] note failed', parsedNote.title, error);
      stats.skipped++;
    }
    if (index % 5 === 0 || index === total - 1) {
      await updateJob(input.jobId, {
        progress: Math.round(((index + 1) / Math.max(total, 1)) * 96),
        message: `已导入 ${stats.notes} / ${total} 篇`,
      });
    }
  }
  return {
    stage: 'done',
    imported: stats.notes,
    attachments: stats.attachments,
    skipped: stats.skipped,
    warnings: input.parsed.warnings.slice(0, 30),
    source: input.parsed.source,
  };
}
