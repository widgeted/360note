import sharp from 'sharp';
import {
  attachmentThumbnailStorageKey,
  isDisplayableImage,
  readAttachment,
  saveAttachment,
} from './storage.js';

export const THUMBNAIL_MAX = 960;
export const THUMBNAIL_QUALITY = 72;

// Small in-process cache avoids an object-storage round trip on the first
// render after upload and on frequently viewed notes. Thumbnails are tiny,
// immutable and safe to evict at any time.
const CACHE_LIMIT_BYTES = 64 * 1024 * 1024;
const cache = new Map<string, Buffer>();
let cacheBytes = 0;

function cacheGet(key: string): Buffer | null {
  const value = cache.get(key);
  if (!value) return null;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheSet(key: string, value: Buffer): void {
  const existing = cache.get(key);
  if (existing) {
    cacheBytes -= existing.length;
    cache.delete(key);
  }
  cache.set(key, value);
  cacheBytes += value.length;
  while (cacheBytes > CACHE_LIMIT_BYTES) {
    const first = cache.keys().next().value as string | undefined;
    if (!first) break;
    const evicted = cache.get(first);
    cache.delete(first);
    cacheBytes -= evicted?.length ?? 0;
  }
}

export async function buildAttachmentThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { animated: false, limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: THUMBNAIL_MAX, height: THUMBNAIL_MAX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toBuffer();
}

/**
 * Return a cached thumbnail, generating it lazily for attachments uploaded
 * before thumbnails existed. Returns null for formats we cannot decode.
 */
export async function ensureAttachmentThumbnail(
  storageKey: string,
  mime: string,
  original?: Buffer,
): Promise<Buffer | null> {
  if (!isDisplayableImage(mime)) return null;
  const cached = cacheGet(storageKey);
  if (cached) return cached;
  const thumbKey = attachmentThumbnailStorageKey(storageKey);
  if (!original) {
    try {
      const stored = await readAttachment(thumbKey);
      cacheSet(storageKey, stored);
      return stored;
    } catch {
      /* generate below */
    }
  }
  try {
    const source = original ?? (await readAttachment(storageKey));
    const thumbnail = await buildAttachmentThumbnail(source);
    // Keep the thumbnail next to its original. Otherwise a local attachment
    // left over during a migration could write its thumbnail to the remote
    // side while the row still points at the local original.
    await saveAttachment(thumbKey, thumbnail, storageKey.startsWith('s3:') ? 's3' : 'local');
    cacheSet(storageKey, thumbnail);
    return thumbnail;
  } catch {
    return null;
  }
}
