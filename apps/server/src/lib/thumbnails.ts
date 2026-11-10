import sharp from 'sharp';
import {
  attachmentThumbnailStorageKey,
  isDisplayableImage,
  readAttachment,
  saveAttachment,
} from './storage.js';

export const THUMBNAIL_MAX = 960;
export const THUMBNAIL_QUALITY = 72;

export async function buildAttachmentThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { animated: false })
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
  const thumbKey = attachmentThumbnailStorageKey(storageKey);
  try {
    return await readAttachment(thumbKey);
  } catch {
    /* generate below */
  }
  try {
    const source = original ?? (await readAttachment(storageKey));
    const thumbnail = await buildAttachmentThumbnail(source);
    // Keep the thumbnail next to its original. Otherwise a local attachment
    // left over during a migration could write its thumbnail to the remote
    // side while the row still points at the local original.
    await saveAttachment(thumbKey, thumbnail, storageKey.startsWith('s3:') ? 's3' : 'local');
    return thumbnail;
  } catch {
    return null;
  }
}
