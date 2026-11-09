import archiver from 'archiver';
import AdmZip from 'adm-zip';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { many, one } from '../db.js';
import { AppError, errors } from '../lib/errors.js';
import { exportHtmlDocument, renderMarkdownHtml } from '../lib/markdown.js';
import { escapeHtml, stripTitleHeading, wordCount } from '../lib/text.js';
import { readAttachment, safeFilename } from '../lib/storage.js';
import { requireWorkspace } from './workspaces.js';
import { audit } from '../lib/audit.js';
import type { Note } from '@360note/shared';

const exec = promisify(execFile);

interface AttachmentFile {
  id: string;
  note_id: string;
  filename: string;
  mime: string;
  storage_key: string;
  size_bytes: string;
}

function yyyyMMdd(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function attachmentRelative(noteId: string, attachment: { filename: string; id: string }): string {
  return `attachments/${noteId}/${attachment.id.slice(0, 8)}-${safeFilename(attachment.filename)}`;
}

function rewriteAttachmentUrls(content: string, noteId: string, attachments: AttachmentFile[]): string {
  let output = content;
  for (const attachment of attachments) {
    const filename = `${attachment.id.slice(0, 8)}-${safeFilename(attachment.filename)}`;
    output = output.replace(
      new RegExp(`(?:https?://[^\\s)"']+)?/api/attachments/${attachment.id}/content`, 'g'),
      attachmentRelative(noteId, { ...attachment, filename }),
    );
  }
  return output;
}

function uniqueName(name: string, used: Set<string>): string {
  const clean = safeFilename(name);
  if (!used.has(clean)) {
    used.add(clean);
    return clean;
  }
  const ext = path.extname(clean);
  const base = clean.slice(0, clean.length - ext.length);
  let index = 2;
  while (used.has(`${base}-${index}${ext}`)) index++;
  const next = `${base}-${index}${ext}`;
  used.add(next);
  return next;
}

async function noteAttachments(noteId: string): Promise<AttachmentFile[]> {
  return many<AttachmentFile>(
    `SELECT id, note_id, filename, mime, storage_key, size_bytes FROM attachments
     WHERE note_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
    [noteId],
  );
}

function frontmatter(input: {
  id: string;
  title: string;
  tags: string[];
  folder: string;
  createdAt: string;
  updatedAt: string;
}): string {
  return `---\nid: ${input.id}\ntitle: ${JSON.stringify(input.title)}\ntags: [${input.tags.map((tag) => JSON.stringify(tag)).join(', ')}]\nfolder: ${JSON.stringify(input.folder)}\ncreated: ${input.createdAt}\nupdated: ${input.updatedAt}\n---\n\n`;
}

async function pdfFromHtml(html: string, title: string): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '360note-pdf-'));
  const htmlPath = path.join(dir, 'note.html');
  const pdfPath = path.join(dir, 'note.pdf');
  const home = path.join(dir, 'home');
  const profile = path.join(dir, 'profile');
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(profile, { recursive: true });
  try {
    await fs.writeFile(htmlPath, html, 'utf8');
    const candidates = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].filter(Boolean) as string[];
    let lastError: unknown = null;
    for (const binary of candidates) {
      try {
        await exec(
          binary,
          [
            '--headless=new',
            '--no-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-pdf-header-footer',
            '--print-to-pdf-no-header',
            `--user-data-dir=${profile}`,
            `--print-to-pdf=${pdfPath}`,
            `file://${htmlPath}`,
          ],
          {
            timeout: 60_000,
            maxBuffer: 16 * 1024 * 1024,
            env: {
              ...process.env,
              HOME: home,
              XDG_CONFIG_HOME: path.join(home, '.config'),
              XDG_CACHE_HOME: path.join(home, '.cache'),
            },
          },
        );
        const pdf = await fs.readFile(pdfPath);
        if (pdf.length > 100) return pdf;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error('No Chromium binary found');
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Avoid server-side image fetches (SSRF) while rendering a PDF. */
function stripExternalImages(html: string): string {
  return html.replace(/<img\b[^>]*\bsrc="(?!data:)[^"]*"[^>]*>/gi, '');
}

export async function exportSingleNote(note: Note, format: 'md' | 'html' | 'pdf', reply: FastifyReply, app: FastifyInstance): Promise<void> {
  const attachments = await noteAttachments(note.id);
  const safeTitle = safeFilename(note.title || '未命名笔记');
  const meta = `${new Date(note.updatedAt).toLocaleString('zh-CN')} · ${wordCount(note.contentMd)} 字`;

  if (format === 'md') {
    if (attachments.length === 0) {
      const body = frontmatter({
        id: note.id,
        title: note.title,
        tags: note.tags.map((tag) => tag.name),
        folder: note.folderPath?.map((item) => item.name).join('/') ?? '',
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      }) + note.contentMd;
      return reply
        .header('Content-Type', 'text/markdown; charset=utf-8')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safeTitle}.md`)}`)
        .send(body);
    }
    const zip = new AdmZip();
    const used = new Set<string>();
    const attachmentPaths = new Map<string, string>();
    for (const attachment of attachments) {
      attachmentPaths.set(
        attachment.id,
        `attachments/${note.id}/${uniqueName(`${attachment.id.slice(0, 8)}-${safeFilename(attachment.filename)}`, used)}`,
      );
    }
    let rewritten = note.contentMd;
    for (const attachment of attachments) {
      rewritten = rewritten.replace(
        new RegExp(`(?:https?://[^\s)"']+)?/api/attachments/${attachment.id}/content`, 'g'),
        attachmentPaths.get(attachment.id)!,
      );
    }
    const readme = frontmatter({
      id: note.id,
      title: note.title,
      tags: note.tags.map((tag) => tag.name),
      folder: note.folderPath?.map((item) => item.name).join('/') ?? '',
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }) + rewritten;
    zip.addFile(`${safeTitle}.md`, Buffer.from(readme, 'utf8'));
    for (const attachment of attachments) {
      const data = await readAttachment(attachment.storage_key);
      zip.addFile(attachmentPaths.get(attachment.id)!, data);
    }
    const buffer = zip.toBuffer();
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safeTitle}.zip`)}`)
      .send(buffer);
  }

  const attachmentMap = new Map<string, { data: Buffer; mime: string; filename: string }>();
  for (const attachment of attachments) {
    try {
      attachmentMap.set(attachment.id, {
        data: await readAttachment(attachment.storage_key),
        mime: attachment.mime,
        filename: attachment.filename,
      });
    } catch (error) {
      app.log.warn({ error, attachmentId: attachment.id }, 'could not read attachment for export');
    }
  }
  let contentHtml = renderMarkdownHtml(stripTitleHeading(note.contentMd, note.title));
  contentHtml = contentHtml.replace(/(src=")(?:https?:\/\/[^"]+)?\/api\/attachments\/([0-9a-fA-F-]{36})\/content(")/g, (match, prefix, id, suffix) => {
    const attachment = attachmentMap.get(id);
    if (!attachment) return match;
    return `${prefix}data:${attachment.mime};base64,${attachment.data.toString('base64')}${suffix}`;
  });
  const attachmentList = attachments.length
    ? `<section class="attachments"><h2>附件</h2><ul>${attachments
        .map((attachment) => {
          const data = attachmentMap.get(attachment.id);
          if (!data) return `<li>${escapeHtml(attachment.filename)}</li>`;
          return `<li><a download="${escapeHtml(attachment.filename)}" href="data:${attachment.mime};base64,${data.data.toString('base64')}">${escapeHtml(attachment.filename)}</a> (${Math.round(Number(attachment.size_bytes) / 1024)} KB)</li>`;
        })
        .join('')}</ul></section>`
    : '';
  const html = exportHtmlDocument({ title: note.title, contentHtml, meta, footer: attachmentList });
  if (format === 'html') {
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safeTitle}.html`)}`)
      .send(html);
  }
  try {
    // The PDF renderer runs Chromium on the server. Only embedded data: images
    // may be loaded; external URLs would let a note probe internal services.
    const pdf = await pdfFromHtml(stripExternalImages(html), note.title);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safeTitle}.pdf`)}`)
      .send(pdf);
  } catch (error) {
    app.log.error({ error }, 'PDF export failed');
    throw new AppError(501, 'PDF_UNAVAILABLE', 'PDF 导出暂时不可用，请改用 HTML 打印为 PDF');
  }
}

interface ExportNoteRow {
  id: string;
  title: string;
  content_md: string;
  folder_id: string | null;
  created_at: Date;
  updated_at: Date;
  tags: Array<{ name: string }>;
}

export async function exportWorkspace(input: {
  workspaceId: string;
  userId: string;
  format: 'md' | 'html' | 'json';
  reply: FastifyReply;
  app: FastifyInstance;
  ip?: string;
}): Promise<void> {
  await requireWorkspace(input.userId, input.workspaceId, 'read');
  const workspace = await one<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [input.workspaceId]);
  if (!workspace) throw errors.notFound('工作区不存在');
  const folders = await many<{ id: string; parent_id: string | null; name: string }>(
    'SELECT id, parent_id, name FROM folders WHERE workspace_id = $1 AND trashed_at IS NULL ORDER BY position, lower(name)',
    [input.workspaceId],
  );
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  function folderPath(folderId: string | null): string[] {
    const parts: string[] = [];
    let current = folderId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const folder = folderMap.get(current);
      if (!folder) break;
      parts.unshift(safeFilename(folder.name));
      current = folder.parent_id;
    }
    return parts;
  }
  const notes = await many<ExportNoteRow>(
    `SELECT n.id, n.title, n.content_md, n.folder_id, n.created_at, n.updated_at,
       COALESCE((SELECT json_agg(json_build_object('name', t.name) ORDER BY lower(t.name))
                 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id), '[]'::json) AS tags
     FROM notes n WHERE n.workspace_id = $1 AND n.deleted_at IS NULL AND n.trashed_at IS NULL
     ORDER BY n.updated_at DESC`,
    [input.workspaceId],
  );
  const allAttachments = await many<AttachmentFile>(
    `SELECT a.id, a.note_id, a.filename, a.mime, a.storage_key, a.size_bytes
     FROM attachments a JOIN notes n ON n.id = a.note_id
     WHERE n.workspace_id = $1 AND n.deleted_at IS NULL AND n.trashed_at IS NULL AND a.deleted_at IS NULL`,
    [input.workspaceId],
  );
  const attachmentsByNote = new Map<string, AttachmentFile[]>();
  for (const attachment of allAttachments) {
    const list = attachmentsByNote.get(attachment.note_id) ?? [];
    list.push(attachment);
    attachmentsByNote.set(attachment.note_id, list);
  }

  const usedNotePaths = new Set<string>();
  const notePaths = new Map<string, string>();
  for (const note of notes) {
    const folderParts = folderPath(note.folder_id);
    const fileName = uniqueName(`${safeFilename(note.title || '未命名笔记')}-${note.id.slice(0, 8)}.md`, usedNotePaths);
    notePaths.set(note.id, ['notes', ...folderParts, fileName].join('/'));
  }

  const exportName = `360note-${safeFilename(workspace.name)}-${yyyyMMdd()}`;
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', (error) => input.app.log.warn({ error }, 'export archive warning'));
  archive.on('error', (error) => input.app.log.error({ error }, 'export archive error'));
  archive.pipe(input.reply.raw);
  input.reply
    .header('Content-Type', 'application/zip')
    .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${exportName}.zip`)}`);
  const counts = { notes: notes.length, folders: folders.length, attachments: allAttachments.length };
  const manifest = {
    format: '360note-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: { id: input.workspaceId, name: workspace.name },
    counts,
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: `${exportName}/manifest.json` });

  const csvEscape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const csvRows = ['id,title,folder,tags,created,updated,words'];
  const htmlIndex = notes
    .map((note) => {
      const noteFile = notePaths.get(note.id)!;
      const rel = noteFile.replace(/^notes\//, '');
      return { note, rel };
    });

  for (const note of notes) {
    const attachments = attachmentsByNote.get(note.id) ?? [];
    const noteFile = notePaths.get(note.id)!;
    const folder = folderPath(note.folder_id).join('/');
    const tags = (note.tags ?? []).map((tag) => tag.name);
    const prefix = '../'.repeat(noteFile.split('/').length - 1);
    let contentWithPaths = note.content_md;
    for (const attachment of attachments) {
      contentWithPaths = contentWithPaths.replace(
        new RegExp(`(?:https?://[^\\s)"']+)?/api/attachments/${attachment.id}/content`, 'g'),
        `${prefix}${attachmentRelative(note.id, attachment)}`,
      );
    }
    if (input.format === 'md' || input.format === 'json') {
      const md = frontmatter({
        id: note.id,
        title: note.title,
        tags,
        folder,
        createdAt: note.created_at.toISOString(),
        updatedAt: note.updated_at.toISOString(),
      }) + contentWithPaths;
      archive.append(md, { name: `${exportName}/${noteFile}` });
    }
    if (input.format === 'html') {
      let contentHtml = renderMarkdownHtml(stripTitleHeading(note.content_md, note.title));
      for (const target of notes) {
        const targetFile = notePaths.get(target.id)!;
        const targetHtml = targetFile.replace(/\.md$/, '.html');
        const relativeHref = path.posix.relative(path.posix.dirname(noteFile), targetHtml);
        const escapedTitle = target.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        contentHtml = contentHtml.replace(
          new RegExp(`class="nh-wikilink" data-note-title="${escapedTitle}"`, 'g'),
          `class="nh-wikilink" href="${relativeHref}"`,
        );
      }
      for (const attachment of attachments) {
        const relative = `${prefix}${attachmentRelative(note.id, attachment)}`;
        contentHtml = contentHtml.replace(
          new RegExp(`(src=")(?:https?://[^"]+)?/api/attachments/${attachment.id}/content(")`, 'g'),
          `$1${relative}$2`,
        );
      }
      const html = exportHtmlDocument({
        title: note.title,
        contentHtml,
        meta: `${new Date(note.updated_at).toLocaleString('zh-CN')} · ${tags.map((tag) => `#${tag}`).join(' ')}`,
      });
      const htmlFile = noteFile.replace(/\.md$/, '.html');
      archive.append(html, { name: `${exportName}/${htmlFile}` });
    }
    for (const attachment of attachments) {
      try {
        const data = await readAttachment(attachment.storage_key);
        archive.append(data, {
          name: `${exportName}/${attachmentRelative(note.id, attachment)}`,
        });
      } catch (error) {
        input.app.log.warn({ error, attachmentId: attachment.id }, 'skipping unreadable attachment in export');
      }
    }
    csvRows.push(
      [note.id, note.title, folder, tags.join('|'), note.created_at.toISOString(), note.updated_at.toISOString(), String(wordCount(note.content_md))]
        .map(csvEscape)
        .join(','),
    );
  }

  if (input.format === 'json') {
    archive.append(
      JSON.stringify(
        {
          format: '360note-workspace',
          version: 1,
          exportedAt: new Date().toISOString(),
          workspace,
          folders: folders.map((folder) => ({ id: folder.id, parentId: folder.parent_id, name: folder.name })),
          notes: notes.map((note) => ({
            id: note.id,
            title: note.title,
            folderId: note.folder_id,
            folderPath: folderPath(note.folder_id),
            tags: (note.tags ?? []).map((tag) => tag.name),
            contentMd: note.content_md,
            createdAt: note.created_at.toISOString(),
            updatedAt: note.updated_at.toISOString(),
          })),
          attachments: allAttachments.map((attachment) => ({
            id: attachment.id,
            noteId: attachment.note_id,
            filename: attachment.filename,
            mime: attachment.mime,
            size: Number(attachment.size_bytes),
            path: attachmentRelative(attachment.note_id, attachment),
          })),
        },
        null,
        2,
      ),
      { name: `${exportName}/data.json` },
    );
  }

  if (input.format === 'md') {
    archive.append(csvRows.join('\n'), { name: `${exportName}/notes.csv` });
    archive.append(
      `# ${workspace.name}\n\n由 360note 导出于 ${new Date().toISOString()}。\n\n- ${counts.notes} 篇笔记\n- ${counts.folders} 个文件夹\n- ${counts.attachments} 个附件\n\n笔记位于 \`notes/\`，保留文件夹层级；附件位于 \`attachments/\`；正文为 Markdown，论文元数据在 YAML frontmatter 中。\n`,
      { name: `${exportName}/README.md` },
    );
  }
  if (input.format === 'html') {
    const listItems = htmlIndex
      .map(({ note, rel }) => {
        const url = rel.replace(/\.md$/, '.html').split('/').map(encodeURIComponent).join('/');
        return `<li><a href="${url}">${escapeHtml(note.title || '未命名笔记')}</a><span>${note.updated_at.toISOString().slice(0, 10)}</span></li>`;
      })
      .join('\n');
    const index = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(workspace.name)} — 360note</title>
    <style>body{background:#f6f4ef;color:#16181d;font-family:Inter,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:760px;margin:0 auto;padding:70px 28px}h1{font-weight:650;font-size:38px;letter-spacing:-.04em;line-height:1.14;margin:0 0 8px}p{color:#6b6a66}ul{list-style:none;padding:0;margin:36px 0}li{display:flex;justify-content:space-between;border-bottom:1px solid #e4e1da;padding:14px 0}a{color:#14161b;text-decoration:none;font-weight:550}a:hover{color:#17865b;text-decoration:none}span{color:#8a8882;font-size:13px}</style></head><body><h1>${escapeHtml(workspace.name)}</h1><p>${counts.notes} 篇笔记 · 导出于 ${new Date().toLocaleDateString('zh-CN')}</p><ul>${listItems}</ul></body></html>`;
    archive.append(index, { name: `${exportName}/index.html` });
    archive.append(csvRows.join('\n'), { name: `${exportName}/notes.csv` });
  }

  await audit({
    workspaceId: input.workspaceId,
    actorId: input.userId,
    action: 'workspace.export',
    targetType: 'workspace',
    targetId: input.workspaceId,
    meta: { format: input.format, ...counts },
    ip: input.ip,
  });
  await archive.finalize();
}
