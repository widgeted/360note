import crypto from 'node:crypto';
import { many, one, query } from '../db.js';
import { deleteObject, getAttachmentStorageConfig, headObject, objectStorageConfigured, putObject, type AttachmentStorageConfig } from '../lib/object-storage.js';
import { isDisplayableImage, readAttachment } from '../lib/storage.js';
import { storeAttachmentThumbnail } from '../lib/thumbnails.js';
import { queueOcr } from '../lib/ocr.js';

interface MediaAttachmentRow {
  id: string;
  workspace_id: string;
  note_id: string;
  filename: string;
  mime: string;
  sha256: string;
  storage_key: string;
  media_key: string | null;
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

function usable(config: AttachmentStorageConfig): boolean {
  return config.enabled && Boolean(config.mediaBaseUrl) && objectStorageConfigured(config);
}

function mediaKey(row: MediaAttachmentRow, config: AttachmentStorageConfig): string {
  const prefix = config.mediaPrefix.replace(/^\/+|\/+$/g, '');
  const extension = EXTENSIONS[row.mime] ?? 'bin';
  return `${prefix ? `${prefix}/` : ''}${row.workspace_id}/${row.id}-${row.sha256.slice(0, 16)}.${extension}`;
}

function mediaPath(key: string): string {
  return `/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function signedMediaUrl(config: AttachmentStorageConfig, key: string, params: Record<string, string | number | undefined>): string {
  const base = config.mediaBaseUrl.replace(/\/+$/, '');
  const path = mediaPath([config.prefix.replace(/^\/+|\/+$/g, ''), key].filter(Boolean).join('/'));
  const pairs = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '')
    .map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`);
  if (!config.cdnAuthKey) {
    return pairs.length ? `${base}${path}?${pairs.join('&')}` : `${base}${path}`;
  }
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const raw = `${config.cdnAuthKey}${path}?_ts=${deadline}${pairs.join('')}`;
  const token = crypto.createHash('md5').update(raw).digest('hex');
  return `${base}${path}?_btf_tk=${token}&_ts=${deadline}${pairs.length ? `&${pairs.join('&')}` : ''}`;
}

/** Upload an unencrypted derivative only for images that are being shared. */
export async function ensureMediaDerivative(attachmentId: string): Promise<string | null> {
  const config = await getAttachmentStorageConfig();
  if (!usable(config)) return null;
  const row = await one<MediaAttachmentRow>(
    `SELECT id, workspace_id, note_id, filename, mime, sha256, storage_key, media_key
     FROM attachments WHERE id = $1 AND deleted_at IS NULL`,
    [attachmentId],
  );
  if (!row || !isDisplayableImage(row.mime)) return null;
  const key = row.media_key || mediaKey(row, config);
  if (!row.media_key || !(await headObject(key, 'attachment')).exists) {
    const data = await readAttachment(row.storage_key);
    await putObject(key, data, row.mime, 'attachment', { encrypted: false, cacheControl: 'public, max-age=31536000, immutable' });
    await query('UPDATE attachments SET media_key = $2 WHERE id = $1', [attachmentId, key]);
  }
  return key;
}

export function isCoreIxPreviewable(mime: string, filename = ''): boolean {
  const lower = filename.toLowerCase();
  return (
    /^image\/(heic|heif|tiff|bmp|x-raw|svg\+xml)$/i.test(mime) ||
    mime === 'application/pdf' ||
    mime.startsWith('video/') ||
    /\.(heic|heif|tif|tiff|bmp|dng|cr2|cr3|nef|arw|raf|orf|rw2|pef|srw|svg|pdf|mp4|m4v|webm|mov)$/i.test(lower)
  );
}

export async function generateCoreIxThumbnail(
  attachmentId: string,
  storageKey: string,
  mime: string,
  filename: string,
): Promise<boolean> {
  const config = await getAttachmentStorageConfig();
  if (!usable(config) || !isCoreIxPreviewable(mime, filename)) return false;
  const extension = EXTENSIONS[mime] ?? 'bin';
  const tempKey = `media/analysis/${crypto.randomUUID()}.${extension}`;
  try {
    const data = await readAttachment(storageKey);
    await putObject(tempKey, data, mime, 'attachment', { encrypted: false, cacheControl: 'no-store' });
    const params: Record<string, string | number | undefined> = {
      fmt: 'webp',
      w: 960,
      q: 72,
      frame: mime === 'application/pdf' ? 0 : mime.startsWith('video/') ? 'auto' : undefined,
    };
    const response = await fetch(signedMediaUrl(config, tempKey, params), {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return false;
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return false;
    const thumbnail = Buffer.from(await response.arrayBuffer());
    await storeAttachmentThumbnail(storageKey, thumbnail);
    await query('UPDATE attachments SET has_thumbnail = true WHERE id = $1', [attachmentId]);
    return true;
  } catch {
    return false;
  } finally {
    await deleteObject(tempKey, 'attachment').catch(() => {});
  }
}

export async function getProcessedShareImage(attachmentId: string): Promise<{ data: Buffer; mime: string; etag: string } | null> {
  const config = await getAttachmentStorageConfig();
  if (!usable(config)) return null;
  const key = await ensureMediaDerivative(attachmentId);
  if (!key) return null;
  const params: Record<string, string | number | undefined> = {
    fmt: config.imageFormat,
    q: config.imageQuality,
    w: config.imageMaxWidth || undefined,
  };
  const response = await fetch(signedMediaUrl(config, key, params), {
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  if (!contentType.startsWith('image/')) return null;
  const data = Buffer.from(await response.arrayBuffer());
  const etag = crypto.createHash('sha256').update(data).digest('hex');
  return { data, mime: contentType.split(';')[0], etag };
}

function functionalLabels(labels: string[]): string[] {
  const blob = labels.join(' ').toLowerCase();
  const output: string[] = [];
  if (/screenshot|screen shot|webpage|ui|website/.test(blob)) output.push('截图', 'Screenshot');
  if (/invoice|receipt|bill|financial|tax/.test(blob)) output.push('发票', 'Invoice');
  if (/document|paper|form|printed|text/.test(blob)) output.push('文档', 'Document');
  return [...new Set(output.length ? output : ['文档', 'Document'])];
}

/**
 * Analyze a newly uploaded image for functional content (screenshots,
 * invoices, documents). The analysis object is temporary and deleted at once.
 * Only runs when the admin explicitly enables functional-image OCR.
 */
export async function detectFunctionalImage(
  attachmentId: string,
  storageKey: string,
  mime: string,
  log: { warn: (obj: unknown, msg?: string) => void },
): Promise<void> {
  const config = await getAttachmentStorageConfig();
  if (!config.detectFunctionalImages || !isDisplayableImage(mime)) return;
  if (!usable(config)) {
    // Media processing is not configured yet; keep OCR working rather than
    // silently dropping text extraction for every uploaded image.
    await query('UPDATE attachments SET ocr_status = $2 WHERE id = $1', [attachmentId, 'pending']).catch(() => {});
    queueOcr(attachmentId, storageKey, mime, log);
    return;
  }
  const extension = EXTENSIONS[mime] ?? 'bin';
  const tempKey = `media/analysis/${crypto.randomUUID()}.${extension}`;
  try {
    const data = await readAttachment(storageKey);
    await putObject(tempKey, data, mime, 'attachment', { encrypted: false, cacheControl: 'no-store' });
    const aestheticUrl = signedMediaUrl(config, tempKey, { fmt: 'aesthetics', w: 800 });
    const aestheticResponse = await fetch(aestheticUrl, { signal: AbortSignal.timeout(20_000) });
    if (!aestheticResponse.ok) return;
    const aesthetic = (await aestheticResponse.json().catch(() => null)) as { utility?: boolean } | null;
    if (!aesthetic?.utility) return;
    const tagsUrl = signedMediaUrl(config, tempKey, { fmt: 'tags', 'tags-min': 0.3, 'tags-max': 10, w: 800 });
    const tagsResponse = await fetch(tagsUrl, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const payload = tagsResponse?.ok
      ? ((await tagsResponse.json().catch(() => null)) as { labels?: Array<{ name?: string }> } | null)
      : null;
    const labels = (payload?.labels ?? []).map((label) => String(label.name ?? '').trim()).filter(Boolean).slice(0, 10);
    const merged = [...new Set([...labels, ...functionalLabels(labels)])];
    await query(
      'UPDATE attachments SET image_tags = $2::jsonb, media_analyzed_at = now(), ocr_status = $3 WHERE id = $1',
      [attachmentId, JSON.stringify(merged), 'pending'],
    );
    queueOcr(attachmentId, storageKey, mime, log);
  } catch (error) {
    log.warn({ error, attachmentId }, 'functional image analysis failed');
    await query('UPDATE attachments SET ocr_status = $2 WHERE id = $1', [attachmentId, 'pending']).catch(() => {});
    queueOcr(attachmentId, storageKey, mime, log);
  } finally {
    await deleteObject(tempKey, 'attachment').catch(() => {});
  }
}

export async function analyzeAttachmentImage(attachmentId: string): Promise<string[]> {
  const config = await getAttachmentStorageConfig();
  if (!usable(config) || config.imageTags === 'off') return [];
  const row = await one<MediaAttachmentRow & { image_tags: unknown; media_analyzed_at: Date | null }>(
    `SELECT id, workspace_id, note_id, filename, mime, sha256, storage_key, media_key, image_tags, media_analyzed_at
     FROM attachments WHERE id = $1 AND deleted_at IS NULL`,
    [attachmentId],
  );
  if (!row || !isDisplayableImage(row.mime)) return [];
  if (Array.isArray(row.image_tags) && row.image_tags.length) return row.image_tags.map(String);
  if (row.media_analyzed_at) return [];
  const key = await ensureMediaDerivative(attachmentId);
  if (!key) return [];
  const url = signedMediaUrl(config, key, { fmt: 'tags', 'tags-min': 0.35, 'tags-max': 8, w: 800 });
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!response?.ok) return [];
  const payload = (await response.json().catch(() => null)) as { labels?: Array<{ name?: string; conf?: number }> } | null;
  const labels = (payload?.labels ?? [])
    .filter((label) => typeof label.name === 'string' && label.name.trim())
    .sort((a, b) => Number(b.conf ?? 0) - Number(a.conf ?? 0))
    .slice(0, 6)
    .map((label) => String(label.name).trim().slice(0, 40));
  await query(
    'UPDATE attachments SET image_tags = $2::jsonb, media_analyzed_at = now() WHERE id = $1',
    [attachmentId, JSON.stringify(labels)],
  );
  if (config.imageTags === 'auto' && labels.length) {
    await applyTagsToNote(row.note_id, row.workspace_id, labels.slice(0, 3));
  }
  return labels;
}

/** Analyze at most a handful of images after a note is shared; never blocks. */
export function scheduleImageAnalysis(noteId: string): void {
  void (async () => {
    const config = await getAttachmentStorageConfig();
    if (!usable(config) || config.imageTags === 'off') return;
    const rows = await many<{ id: string }>(
      `SELECT id FROM attachments
       WHERE note_id = $1 AND deleted_at IS NULL
         AND media_analyzed_at IS NULL
         AND mime IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif')
       ORDER BY created_at ASC LIMIT 8`,
      [noteId],
    );
    for (const row of rows) {
      await analyzeAttachmentImage(row.id).catch(() => {});
    }
  })().catch(() => {});
}

async function applyTagsToNote(noteId: string, workspaceId: string, names: string[]): Promise<void> {
  const note = await one<{ trashed_at: Date | null }>('SELECT trashed_at FROM notes WHERE id = $1 AND deleted_at IS NULL', [noteId]);
  if (!note || note.trashed_at) return;
  for (const name of names) {
    const tag = await one<{ id: string }>(
      `INSERT INTO tags (workspace_id, name) VALUES ($1, $2)
       ON CONFLICT (workspace_id, lower(name)) DO UPDATE SET name = tags.name
       RETURNING id`,
      [workspaceId, name],
    );
    if (tag) {
      await query('INSERT INTO note_tags (note_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [noteId, tag.id]);
    }
  }
}
