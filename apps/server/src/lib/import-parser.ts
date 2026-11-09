import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import matter from 'gray-matter';
import { XMLParser } from 'fast-xml-parser';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { safeFilename } from './storage.js';
import { markdownToPlainText, titleFromMarkdown } from './text.js';
import { errors } from './errors.js';

export interface ParsedAttachment {
  key: string;
  filename: string;
  mime: string;
  storedPath: string;
}

export interface ParsedNote {
  title: string;
  contentMd: string;
  folderPath: string[];
  tags: string[];
  attachments: ParsedAttachment[];
}

export interface ParsedImport {
  source: 'markdown' | 'html' | 'enex' | 'notion' | 'csv' | 'json' | 'unknown';
  notes: ParsedNote[];
  warnings: string[];
}

interface UploadedFile {
  originalName: string;
  storedPath: string;
}

const MAX_NOTES = 3000;
const MAX_ZIP_BYTES = 400 * 1024 * 1024;
const MAX_ENTRIES = 6000;
const MAX_COMPRESSION_RATIO = 500;

function attachmentMarker(key: string): string {
  return `360note-attachment://${key}`;
}

function mimeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain',
    '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.zip': 'application/zip',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] ?? 'application/octet-stream';
}

function safeZipName(name: string): string {
  const normalized = name.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw errors.badRequest('压缩包包含不安全的路径');
  }
  return normalized;
}

async function extractZip(zipPath: string, targetDir: string): Promise<Map<string, string>> {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length > MAX_ENTRIES) throw errors.badRequest('压缩包内文件过多');
  let total = 0;
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = safeZipName(entry.entryName);
    if (name.startsWith('__MACOSX/') || name.startsWith('.DS_Store')) continue;
    // Reject oversized entries from their headers before inflating them. A
    // small zip can declare gigabytes and otherwise exhaust server memory.
    const declared = Number(entry.header.size ?? 0);
    const compressed = Number(entry.header.compressedSize ?? 0);
    if (declared > MAX_ZIP_BYTES || total + declared > MAX_ZIP_BYTES) {
      throw errors.badRequest('解压后的文件过大');
    }
    if (declared > 1024 * 1024 && (compressed === 0 || declared / compressed > MAX_COMPRESSION_RATIO)) {
      throw errors.badRequest('压缩包压缩比异常');
    }
    const data = entry.getData();
    total += data.length;
    if (total > MAX_ZIP_BYTES) throw errors.badRequest('解压后的文件过大');
    const output = path.join(targetDir, name);
    const resolved = path.resolve(output);
    if (!resolved.startsWith(path.resolve(targetDir) + path.sep)) throw errors.badRequest('压缩包包含不安全的路径');
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, data);
    files.set(name, output);
  }
  return files;
}

function uniqueKey(): string {
  return crypto.randomUUID();
}

async function stageAttachment(jobDir: string, name: string, data: Buffer, mime?: string): Promise<ParsedAttachment> {
  const key = uniqueKey();
  const filename = safeFilename(name);
  const dir = path.join(jobDir, 'files');
  await fs.mkdir(dir, { recursive: true });
  const storedPath = path.join(dir, `${key}-${filename}`);
  await fs.writeFile(storedPath, data, { mode: 0o600 });
  return { key, filename, mime: mime || mimeFor(filename), storedPath: path.relative(jobDir, storedPath) };
}

function normalizeTagList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).replace(/^#/, '').trim()).filter(Boolean).slice(0, 30);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim().replace(/^#/, '')).filter(Boolean).slice(0, 30);
  return [];
}

function cleanTitle(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 500) || '未命名笔记';
}

const LOCAL_LINK = /(!?\[[^\]]*\]\()([^)\s]+)(\))/g;

async function parseMarkdownFile(input: {
  content: string;
  titleHint: string;
  folderPath: string[];
  jobDir: string;
  baseDir: string;
}): Promise<ParsedNote> {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(input.content);
  } catch {
    parsed = { data: {}, content: input.content } as matter.GrayMatterFile<string>;
  }
  const data = parsed.data as Record<string, unknown>;
  let content = parsed.content;
  const tags = normalizeTagList(data.tags ?? data.tag ?? data.Tags);
  let title = cleanTitle(
    String(data.title ?? data.Title ?? '') ||
      (content.match(/^#\s+(.+)$/m)?.[1] ?? '') ||
      input.titleHint,
  );
  if (!title || title === '未命名笔记') title = cleanTitle(titleFromMarkdown(content) || input.titleHint);
  const attachments: ParsedAttachment[] = [];
  const matches = [...content.matchAll(LOCAL_LINK)];
  for (const match of matches) {
    const rawTarget = match[2];
    if (/^(?:https?:|data:|mailto:|#|\/)/i.test(rawTarget)) continue;
    let decoded = rawTarget;
    try {
      decoded = decodeURIComponent(rawTarget.split('#')[0].split('?')[0]);
    } catch {
      /* keep raw */
    }
    const candidate = path.resolve(input.baseDir, decoded);
    if (!candidate.startsWith(path.resolve(input.jobDir) + path.sep)) continue;
    try {
      const dataBuffer = await fs.readFile(candidate);
      const attachment = await stageAttachment(input.jobDir, path.basename(decoded), dataBuffer);
      attachments.push(attachment);
      content = content.replace(match[0], `${match[1]}${attachmentMarker(attachment.key)}${match[3]}`);
    } catch {
      /* skip unreadable link */
    }
  }
  // Markdown local links that are not images but are files become attachments too.
  content = content.replace(/^---[\s\S]*?---\s*/, '');
  return { title, contentMd: content, folderPath: input.folderPath, tags, attachments };
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else field += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim().length));
}

function csvToMarkdown(text: string): { markdown: string; rows: number; truncated: boolean } {
  const rows = parseCsvRows(text);
  if (!rows.length) return { markdown: '', rows: 0, truncated: false };
  const width = Math.min(Math.max(...rows.map((row) => row.length)), 24);
  const cell = (value: string) => (value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>').slice(0, 500);
  const header = rows[0]?.slice(0, width) ?? [];
  while (header.length < width) header.push('');
  const lines = [
    `| ${header.map(cell).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  const body = rows.slice(1, 2001);
  for (const row of body) {
    const values = row.slice(0, width);
    while (values.length < width) values.push('');
    lines.push(`| ${values.map(cell).join(' | ')} |`);
  }
  return { markdown: lines.join('\n'), rows: rows.length - 1, truncated: rows.length - 1 > 2000 };
}

async function parseEnex(input: { filePath: string; jobDir: string; warnings: string[] }): Promise<ParsedNote[]> {
  const xml = await fs.readFile(input.filePath, 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: false,
  });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw errors.badRequest('无法解析 Evernote 文件');
  }
  const enex = doc['en-export'] as Record<string, unknown> | undefined;
  const rawNotes = enex?.note;
  const list = Array.isArray(rawNotes) ? rawNotes : rawNotes ? [rawNotes] : [];
  const notes: ParsedNote[] = [];
  for (const raw of list.slice(0, MAX_NOTES)) {
    const note = raw as Record<string, unknown>;
    const title = cleanTitle(String(note.title ?? '未命名笔记'));
    const rawContent = String(note.content ?? '');
    let contentHtml = rawContent
      .replace(/<\?xml[\s\S]*?\?>/gi, '')
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      .replace(/<\/?en-note[^>]*>/gi, '');
    const mediaRegex = /<en-media[^>]*\/?>/gi;
    contentHtml = contentHtml.replace(mediaRegex, '');
    let contentMd = NodeHtmlMarkdown.translate(contentHtml).trim();
    const tags = normalizeTagList(note.tag);
    const attachments: ParsedAttachment[] = [];
    const resources = note.resource;
    const resourceList = Array.isArray(resources) ? resources : resources ? [resources] : [];
    for (const resourceRaw of resourceList) {
      const resource = resourceRaw as Record<string, unknown>;
      const dataNode = resource.data as Record<string, unknown> | string | undefined;
      const base64 = typeof dataNode === 'string' ? dataNode : String((dataNode as Record<string, unknown>)?.['#text'] ?? '');
      const mime = String(resource.mime ?? 'application/octet-stream');
      const attributes = (resource['resource-attributes'] ?? {}) as Record<string, unknown>;
      const filename = safeFilename(String(attributes['file-name'] ?? `attachment-${attachments.length + 1}`));
      if (!base64) continue;
      try {
        const buffer = Buffer.from(base64.replace(/\s/g, ''), 'base64');
        if (!buffer.length) continue;
        const attachment = await stageAttachment(input.jobDir, filename, buffer, mime);
        attachments.push(attachment);
        contentMd += `\n\n[${filename}](${attachmentMarker(attachment.key)})`;
      } catch {
        input.warnings.push(`无法读取附件：${filename}`);
      }
    }
    notes.push({ title, contentMd, folderPath: [], tags, attachments });
  }
  return notes;
}

async function parseNotionOrMarkdown(input: {
  jobDir: string;
  files: Map<string, string>;
  warnings: string[];
  isNotion: boolean;
}): Promise<ParsedNote[]> {
  const notes: ParsedNote[] = [];
  const markdownFiles = [...input.files.entries()].filter(([name]) => /\.(md|markdown)$/i.test(name));
  const csvFiles = [...input.files.entries()].filter(([name]) => /\.csv$/i.test(name));
  const htmlFiles = [...input.files.entries()].filter(([name]) => /\.(html|htm)$/i.test(name));
  for (const [name, filePath] of [...markdownFiles, ...htmlFiles].slice(0, MAX_NOTES)) {
    const raw = await fs.readFile(filePath, 'utf8');
    const isHtml = /\.(html|htm)$/i.test(name);
    const content = isHtml ? NodeHtmlMarkdown.translate(raw) : raw;
    const folderPath = path.dirname(name).split('/').filter((part) => part && part !== '.');
    const hint = path.basename(name, path.extname(name));
    try {
      notes.push(
        await parseMarkdownFile({
          content,
          titleHint: hint,
          folderPath,
          jobDir: input.jobDir,
          baseDir: path.dirname(filePath),
        }),
      );
    } catch (error) {
      input.warnings.push(`跳过 ${name}：${(error as Error).message}`);
    }
  }
  for (const [name, filePath] of csvFiles.slice(0, 200)) {
    const text = await fs.readFile(filePath, 'utf8');
    const { markdown, rows, truncated } = csvToMarkdown(text);
    if (truncated) input.warnings.push(`${name} 超过 2000 行，已截断`);
    notes.push({
      title: cleanTitle(path.basename(name, '.csv')),
      contentMd: `# ${path.basename(name, '.csv')}\n\n${markdown}\n`,
      folderPath: path.dirname(name).split('/').filter((part) => part && part !== '.'),
      tags: [],
      attachments: [],
    });
    if (rows === 0) input.warnings.push(`${name} 没有数据行`);
  }
  return notes;
}

async function parseJsonExport(input: { jobDir: string; jsonPath: string; files: Map<string, string>; warnings: string[] }): Promise<ParsedNote[]> {
  const data = JSON.parse(await fs.readFile(input.jsonPath, 'utf8')) as {
    format?: string;
    notes?: Array<{ id?: string; title?: string; contentMd?: string; folderPath?: string[]; tags?: string[] }>;
    attachments?: Array<{ id: string; noteId: string; filename: string; path: string; mime?: string }>;
  };
  if (data.format !== '360note-workspace' || !Array.isArray(data.notes)) throw errors.badRequest('无法识别的 JSON 导出格式');
  const notes: ParsedNote[] = [];
  for (const note of data.notes.slice(0, MAX_NOTES)) {
    const attachments: ParsedAttachment[] = [];
    let content = note.contentMd ?? '';
    for (const meta of (data.attachments ?? []).filter((attachment) => attachment.noteId === note.id)) {
      const source = input.files.get(meta.path);
      if (!source) continue;
      const buffer = await fs.readFile(source);
      const attachment = await stageAttachment(input.jobDir, meta.filename, buffer, meta.mime);
      attachments.push(attachment);
      content = content.replace(
        new RegExp(`(?:https?://[^\\s)"']+)?/api/attachments/${meta.id}/content`, 'g'),
        attachmentMarker(attachment.key),
      );
    }
    notes.push({
      title: cleanTitle(note.title ?? '未命名笔记'),
      contentMd: content,
      folderPath: note.folderPath ?? [],
      tags: normalizeTagList(note.tags),
      attachments,
    });
  }
  return notes;
}

export async function parseImport(input: {
  jobDir: string;
  uploads: UploadedFile[];
}): Promise<ParsedImport> {
  const warnings: string[] = [];
  let source: ParsedImport['source'] = 'unknown';
  let notes: ParsedNote[] = [];
  const primary = input.uploads[0];
  if (!primary) throw errors.badRequest('没有可导入的文件');
  const extension = path.extname(primary.originalName).toLowerCase();

  if (extension === '.zip') {
    const extractDir = path.join(input.jobDir, 'unzipped');
    await fs.mkdir(extractDir, { recursive: true });
    const files = await extractZip(primary.storedPath, extractDir);
    const names = [...files.keys()];
    const enex = names.find((name) => name.toLowerCase().endsWith('.enex'));
    if (enex) {
      source = 'enex';
      notes = await parseEnex({ filePath: files.get(enex)!, jobDir: input.jobDir, warnings });
    } else {
      const dataJson = names.find((name) => name === 'data.json' || name.endsWith('/data.json'));
      const manifest = names.find((name) => name === 'manifest.json' || name.endsWith('/manifest.json'));
      if (dataJson) {
        source = 'json';
        notes = await parseJsonExport({ jobDir: input.jobDir, jsonPath: files.get(dataJson)!, files, warnings });
      } else if (manifest) {
        source = 'json';
        const raw = JSON.parse(await fs.readFile(files.get(manifest)!, 'utf8')) as { format?: string };
        if (raw.format === '360note-backup') {
          throw errors.badRequest('这是完整备份文件，请在“备份与恢复”中恢复，而不是导入');
        }
        notes = await parseNotionOrMarkdown({ jobDir: input.jobDir, files, warnings, isNotion: false });
      } else {
        const isNotion = names.some((name) => name.toLowerCase().endsWith('.csv')) || names.some((name) => name.includes('%20'));
        source = isNotion ? 'notion' : 'markdown';
        notes = await parseNotionOrMarkdown({ jobDir: input.jobDir, files, warnings, isNotion });
      }
    }
  } else if (extension === '.enex') {
    source = 'enex';
    notes = await parseEnex({ filePath: primary.storedPath, jobDir: input.jobDir, warnings });
  } else if (extension === '.csv') {
    source = 'csv';
    const text = await fs.readFile(primary.storedPath, 'utf8');
    const { markdown, rows, truncated } = csvToMarkdown(text);
    if (truncated) warnings.push('CSV 超过 2000 行，已截断');
    notes = [{
      title: cleanTitle(path.basename(primary.originalName, extension)),
      contentMd: `# ${path.basename(primary.originalName, extension)}\n\n${markdown}\n`,
      folderPath: [],
      tags: [],
      attachments: [],
    }];
    if (rows === 0) warnings.push('CSV 没有数据行');
  } else if (extension === '.json') {
    source = 'json';
    const files = new Map<string, string>();
    for (const upload of input.uploads) files.set(upload.originalName, upload.storedPath);
    try {
      notes = await parseJsonExport({ jobDir: input.jobDir, jsonPath: primary.storedPath, files, warnings });
    } catch {
      warnings.push('JSON 不是 360note 导出格式，已作为纯文本笔记导入');
      notes = [{
        title: cleanTitle(path.basename(primary.originalName, extension)),
        contentMd: '```json\n' + (await fs.readFile(primary.storedPath, 'utf8')).slice(0, 500_000) + '\n```',
        folderPath: [],
        tags: [],
        attachments: [],
      }];
    }
  } else if (['.html', '.htm', '.md', '.markdown', '.txt'].includes(extension)) {
    source = extension.startsWith('.htm') ? 'html' : 'markdown';
    const files = new Map<string, string>();
    for (const upload of input.uploads) files.set(upload.originalName, upload.storedPath);
    for (const upload of input.uploads.slice(0, MAX_NOTES)) {
      const raw = await fs.readFile(upload.storedPath, 'utf8');
      const content = /\.(html|htm)$/i.test(upload.originalName) ? NodeHtmlMarkdown.translate(raw) : raw;
      const note = await parseMarkdownFile({
        content,
        titleHint: path.basename(upload.originalName, path.extname(upload.originalName)),
        folderPath: [],
        jobDir: input.jobDir,
        baseDir: path.dirname(upload.storedPath),
      });
      notes.push(note);
    }
  } else {
    throw errors.badRequest('暂不支持这种文件格式。请上传 Markdown、HTML、ENEX、CSV、JSON 或 ZIP');
  }

  if (!notes.length) throw errors.badRequest('没有找到可导入的笔记');
  if (notes.length > MAX_NOTES) {
    notes = notes.slice(0, MAX_NOTES);
    warnings.push(`一次最多导入 ${MAX_NOTES} 篇笔记，剩余内容已截断`);
  }
  for (const note of notes) {
    if (!note.contentMd.trim() && !note.attachments.length) {
      note.contentMd = `# ${note.title}\n`;
    }
    note.tags = [...new Set(note.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 30);
  }
  return { source, notes, warnings: warnings.slice(0, 40) };
}

export function previewFromParsed(parsed: ParsedImport): {
  source: ParsedImport['source'];
  noteCount: number;
  attachmentCount: number;
  folders: string[];
  warnings: string[];
  samples: Array<{ title: string; folder: string | null; excerpt: string }>;
} {
  return {
    source: parsed.source,
    noteCount: parsed.notes.length,
    attachmentCount: parsed.notes.reduce((sum, note) => sum + note.attachments.length, 0),
    folders: [...new Set(parsed.notes.map((note) => note.folderPath.join('/')).filter(Boolean))].slice(0, 60),
    warnings: parsed.warnings,
    samples: parsed.notes.slice(0, 8).map((note) => ({
      title: note.title,
      folder: note.folderPath.join('/') || null,
      excerpt: markdownToPlainText(note.contentMd).slice(0, 120),
    })),
  };
}
