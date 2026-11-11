import crypto from 'node:crypto';
import { many, one, query } from '../db.js';
import { getAttachmentStorageConfig, headObject, objectStorageConfigured, putObject, type AttachmentStorageConfig } from '../lib/object-storage.js';
import { isDisplayableImage, readAttachment } from '../lib/storage.js';

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
