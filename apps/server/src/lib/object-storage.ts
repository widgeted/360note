import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { decryptString, encryptString } from './crypto.js';
import { getSetting, setSetting } from '../services/settings.js';

export interface ObjectStorageConfig {
  enabled: boolean;
  attachmentsEnabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export type ImageFormatPreference = 'auto' | 'webp' | 'jpg';
export type ImageTaggingMode = 'off' | 'suggest' | 'auto';

export interface AttachmentStorageConfig extends ObjectStorageConfig {
  mediaBaseUrl: string;
  cdnAuthKey: string;
  mediaPrefix: string;
  imageFormat: ImageFormatPreference;
  imageQuality: number;
  imageMaxWidth: number;
  imageTags: ImageTaggingMode;
}

interface StoredObjectStorage {
  enabled?: boolean;
  attachmentsEnabled?: boolean;
  endpoint?: string;
  region?: string;
  bucket?: string;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKeyEnc?: string;
  forcePathStyle?: boolean;
}

interface StoredAttachmentStorage extends StoredObjectStorage {
  mediaBaseUrl?: string;
  cdnAuthKeyEnc?: string;
  mediaPrefix?: string;
  imageFormat?: ImageFormatPreference;
  imageQuality?: number;
  imageMaxWidth?: number;
  imageTags?: ImageTaggingMode;
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastError?: string | null;
}

let forceLocal = false;

/**
 * While an attachment migration is running new uploads must stay on the
 * original side, otherwise a row written after the migration snapshot would
 * be missed. Reads never depend on this flag: they always follow the key
 * stored on the attachment row.
 */
export function setAttachmentStorageMigrationMode(migrating: boolean): void {
  forceLocal = migrating;
}

export function attachmentStorageMigrationMode(): boolean {
  return forceLocal;
}

/** Backup/offsite copy configuration. */
export async function getBackupStorageConfig(): Promise<ObjectStorageConfig> {
  const stored = await getSetting<StoredObjectStorage>('offsite');
  return {
    enabled: Boolean(stored?.enabled),
    attachmentsEnabled: Boolean(stored?.attachmentsEnabled),
    endpoint: stored?.endpoint ?? '',
    region: stored?.region ?? 'auto',
    bucket: stored?.bucket ?? '',
    prefix: stored?.prefix ?? '360note/',
    accessKeyId: stored?.accessKeyId ?? '',
    secretAccessKey: stored?.secretAccessKeyEnc ? decryptString(stored.secretAccessKeyEnc, 'instance:offsite') : '',
    forcePathStyle: stored?.forcePathStyle ?? true,
  };
}

const MEDIA_DEFAULTS = {
  mediaPrefix: 'media/',
  imageFormat: 'auto' as ImageFormatPreference,
  imageQuality: 82,
  imageMaxWidth: 1600,
  imageTags: 'suggest' as ImageTaggingMode,
};

/**
 * Dedicated attachment storage. If no dedicated setting exists yet, fall back
 * to the legacy offsite configuration so existing remote attachments keep
 * working without a data migration.
 */
export async function getAttachmentStorageConfig(): Promise<AttachmentStorageConfig> {
  const stored = await getSetting<StoredAttachmentStorage>('attachmentStorage');
  if (stored && (stored.endpoint || stored.bucket || stored.accessKeyId)) {
    return {
      enabled: Boolean(stored.enabled),
      attachmentsEnabled: Boolean(stored.enabled),
      endpoint: stored.endpoint ?? '',
      region: stored.region ?? 'cn-east-1',
      bucket: stored.bucket ?? '',
      prefix: stored.prefix ?? '',
      accessKeyId: stored.accessKeyId ?? '',
      secretAccessKey: stored.secretAccessKeyEnc ? decryptString(stored.secretAccessKeyEnc, 'instance:attachment-storage') : '',
      forcePathStyle: stored.forcePathStyle ?? true,
      mediaBaseUrl: stored.mediaBaseUrl ?? '',
      cdnAuthKey: stored.cdnAuthKeyEnc ? decryptString(stored.cdnAuthKeyEnc, 'instance:attachment-storage-cdn') : '',
      mediaPrefix: stored.mediaPrefix ?? MEDIA_DEFAULTS.mediaPrefix,
      imageFormat: stored.imageFormat ?? MEDIA_DEFAULTS.imageFormat,
      imageQuality: Math.min(95, Math.max(40, Number(stored.imageQuality) || MEDIA_DEFAULTS.imageQuality)),
      imageMaxWidth: Math.min(4096, Math.max(0, Number(stored.imageMaxWidth) || MEDIA_DEFAULTS.imageMaxWidth)),
      imageTags: stored.imageTags ?? MEDIA_DEFAULTS.imageTags,
    };
  }
  const legacy = await getBackupStorageConfig();
  return {
    ...legacy,
    enabled: Boolean((await getSetting<StoredObjectStorage>('offsite'))?.attachmentsEnabled),
    attachmentsEnabled: Boolean((await getSetting<StoredObjectStorage>('offsite'))?.attachmentsEnabled),
    mediaBaseUrl: '',
    cdnAuthKey: '',
    ...MEDIA_DEFAULTS,
  };
}

/** Attachment functions use this as their default storage target. */
export async function getObjectStorageConfig(): Promise<AttachmentStorageConfig> {
  return getAttachmentStorageConfig();
}

export async function saveAttachmentStorageConfig(input: Partial<AttachmentStorageConfig> & { secretAccessKey?: string; cdnAuthKey?: string }): Promise<void> {
  const existing = (await getSetting<StoredAttachmentStorage>('attachmentStorage')) ?? {};
  const legacy = await getBackupStorageConfig();
  const secret =
    input.secretAccessKey !== undefined && input.secretAccessKey !== ''
      ? encryptString(input.secretAccessKey, 'instance:attachment-storage')
      : existing.secretAccessKeyEnc ?? (legacy.secretAccessKey ? encryptString(legacy.secretAccessKey, 'instance:attachment-storage') : '');
  const cdnSecret =
    input.cdnAuthKey !== undefined && input.cdnAuthKey !== ''
      ? encryptString(input.cdnAuthKey, 'instance:attachment-storage-cdn')
      : existing.cdnAuthKeyEnc ?? '';
  const value: StoredAttachmentStorage = {
    enabled: input.enabled ?? existing.enabled ?? false,
    attachmentsEnabled: input.enabled ?? existing.enabled ?? false,
    endpoint: input.endpoint ?? existing.endpoint ?? '',
    region: input.region ?? existing.region ?? 'cn-east-1',
    bucket: input.bucket ?? existing.bucket ?? '',
    prefix: input.prefix ?? existing.prefix ?? '',
    accessKeyId: input.accessKeyId ?? existing.accessKeyId ?? '',
    secretAccessKeyEnc: secret,
    forcePathStyle: input.forcePathStyle ?? existing.forcePathStyle ?? true,
    mediaBaseUrl: input.mediaBaseUrl ?? existing.mediaBaseUrl ?? '',
    cdnAuthKeyEnc: cdnSecret,
    mediaPrefix: input.mediaPrefix ?? existing.mediaPrefix ?? MEDIA_DEFAULTS.mediaPrefix,
    imageFormat: input.imageFormat ?? existing.imageFormat ?? MEDIA_DEFAULTS.imageFormat,
    imageQuality: input.imageQuality ?? existing.imageQuality ?? MEDIA_DEFAULTS.imageQuality,
    imageMaxWidth: input.imageMaxWidth ?? existing.imageMaxWidth ?? MEDIA_DEFAULTS.imageMaxWidth,
    imageTags: input.imageTags ?? existing.imageTags ?? MEDIA_DEFAULTS.imageTags,
    lastTestAt: existing.lastTestAt,
    lastTestOk: existing.lastTestOk,
    lastError: existing.lastError,
  };
  await setSetting('attachmentStorage', value as unknown as Record<string, unknown>);
}

export async function attachmentStoragePublicConfig(): Promise<Record<string, unknown>> {
  const config = await getAttachmentStorageConfig();
  const stored = (await getSetting<StoredAttachmentStorage>('attachmentStorage')) ?? {};
  const legacy = !stored.endpoint && !stored.bucket;
  return {
    enabled: config.enabled,
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    prefix: config.prefix,
    accessKeyId: config.accessKeyId,
    hasSecret: Boolean(stored.secretAccessKeyEnc) || legacy,
    forcePathStyle: config.forcePathStyle,
    mediaBaseUrl: config.mediaBaseUrl,
    hasCdnAuthKey: Boolean(stored.cdnAuthKeyEnc),
    mediaPrefix: config.mediaPrefix,
    imageFormat: config.imageFormat,
    imageQuality: config.imageQuality,
    imageMaxWidth: config.imageMaxWidth,
    imageTags: config.imageTags,
    legacy,
    lastTestAt: stored.lastTestAt ?? null,
    lastTestOk: stored.lastTestOk ?? null,
    lastError: stored.lastError ?? null,
  };
}

export async function setAttachmentsEnabledSetting(value: boolean): Promise<void> {
  const stored = await getSetting<StoredAttachmentStorage>('attachmentStorage');
  if (stored && (stored.endpoint || stored.bucket || stored.accessKeyId)) {
    await setSetting('attachmentStorage', { ...stored, enabled: value, attachmentsEnabled: value } as Record<string, unknown>);
    return;
  }
  const offsite = (await getSetting<Record<string, unknown>>('offsite')) ?? {};
  await setSetting('offsite', { ...offsite, attachmentsEnabled: value });
}

export async function setAttachmentStorageTestResult(ok: boolean, error: string | null): Promise<void> {
  const stored = (await getSetting<StoredAttachmentStorage>('attachmentStorage')) ?? {};
  if (!stored.endpoint && !stored.bucket) return;
  await setSetting('attachmentStorage', {
    ...stored,
    lastTestAt: new Date().toISOString(),
    lastTestOk: ok,
    lastError: error,
  } as unknown as Record<string, unknown>);
}

export function objectStorageConfigured(config: ObjectStorageConfig): boolean {
  return Boolean(config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey);
}

export type StorageTarget = 'attachment' | 'backup';

async function configFor(target: StorageTarget): Promise<ObjectStorageConfig> {
  return target === 'backup' ? getBackupStorageConfig() : getAttachmentStorageConfig();
}

function client(config: ObjectStorageConfig): S3Client {
  return new S3Client({
    region: config.region || 'auto',
    endpoint: config.endpoint || undefined,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

function keyFor(config: ObjectStorageConfig, key: string): string {
  const prefix = config.prefix.replace(/^\/+|\/+$/g, '');
  const relative = key.replace(/^s3:/, '').replace(/^\/+/, '');
  return prefix ? `${prefix}/${relative}` : relative;
}

function relativeKey(storageKey: string): string {
  return storageKey.replace(/^s3:/, '').replace(/^\/+/, '');
}

export function attachmentObjectStorageKey(storageKey: string): string {
  const relative = relativeKey(storageKey);
  return `s3:attachments/${relative}`;
}

export function attachmentStorageKeyFromObject(storageKey: string): string {
  return relativeKey(storageKey).replace(/^attachments\//, '');
}

export async function putObject(
  storageKey: string,
  data: Buffer,
  contentType = 'application/octet-stream',
  target: StorageTarget = 'attachment',
  options?: { encrypted?: boolean; cacheControl?: string },
): Promise<void> {
  const config = await configFor(target);
  if (!objectStorageConfigured(config)) throw new Error('对象存储配置不完整');
  await client(config).send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: keyFor(config, storageKey),
    Body: data,
    ContentType: contentType,
    CacheControl: options?.cacheControl,
    Metadata: { app: '360note', ...(options?.encrypted === false ? {} : { encryption: 'aes-256-gcm' }) },
  }));
}

export async function putObjectStream(
  storageKey: string,
  body: Readable,
  contentLength: number,
  contentType = 'application/octet-stream',
  target: StorageTarget = 'attachment',
): Promise<void> {
  const config = await configFor(target);
  if (!objectStorageConfigured(config)) throw new Error('对象存储配置不完整');
  await client(config).send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: keyFor(config, storageKey),
    Body: body,
    ContentLength: contentLength,
    ContentType: contentType,
    Metadata: { app: '360note', encryption: 'aes-256-gcm' },
  }));
}

export async function getObject(storageKey: string, target: StorageTarget = 'attachment'): Promise<Buffer> {
  const config = await configFor(target);
  if (!objectStorageConfigured(config)) throw new Error('对象存储配置不完整');
  const response = await client(config).send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: keyFor(config, storageKey),
  }));
  if (!response.Body) throw new Error('对象存储返回为空');
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function deleteObject(storageKey: string, target: StorageTarget = 'attachment'): Promise<void> {
  const config = await configFor(target);
  if (!objectStorageConfigured(config)) return;
  await client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: keyFor(config, storageKey) }));
}

export async function headObject(storageKey: string, target: StorageTarget = 'attachment'): Promise<{ exists: boolean; size: number; etag: string | null }> {
  const config = await configFor(target);
  if (!objectStorageConfigured(config)) return { exists: false, size: 0, etag: null };
  try {
    const response = await client(config).send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: keyFor(config, storageKey) }),
    );
    return { exists: true, size: Number(response.ContentLength ?? 0), etag: response.ETag?.replace(/^"|"$/g, '') ?? null };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return { exists: false, size: 0, etag: null };
    throw error;
  }
}

export async function objectExists(storageKey: string, target: StorageTarget = 'attachment'): Promise<boolean> {
  return (await headObject(storageKey, target)).exists;
}

function listPrefix(config: ObjectStorageConfig, prefix: string): string {
  const base = config.prefix.replace(/^\/+|\/+$/g, '');
  if (!prefix) return base ? `${base}/` : '';
  return base ? `${base}/${prefix}` : prefix;
}

/** List app-relative keys (the prefix itself is stripped). */
export async function listObjectKeys(prefix = '', target: StorageTarget = 'attachment'): Promise<string[]> {
  const config = await configFor(target);
  if (!objectStorageConfigured(config)) return [];
  const base = config.prefix.replace(/^\/+|\/+$/g, '');
  let token: string | undefined;
  const keys: string[] = [];
  do {
    const response = await client(config).send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: listPrefix(config, prefix),
      ContinuationToken: token,
      MaxKeys: 1000,
    }));
    for (const item of response.Contents ?? []) {
      if (!item.Key) continue;
      keys.push(base && item.Key.startsWith(`${base}/`) ? item.Key.slice(base.length + 1) : item.Key);
    }
    token = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function objectUsage(prefix = 'attachments/', target: StorageTarget = 'attachment'): Promise<{ objects: number; bytes: number }> {
  const config = await configFor(target);
  if (!objectStorageConfigured(config)) return { objects: 0, bytes: 0 };
  let token: string | undefined;
  let objects = 0;
  let bytes = 0;
  do {
    const response = await client(config).send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: listPrefix(config, prefix),
      ContinuationToken: token,
      MaxKeys: 1000,
    }));
    for (const item of response.Contents ?? []) {
      objects += 1;
      bytes += item.Size ?? 0;
    }
    token = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token);
  return { objects, bytes };
}

/** Delete every object under an app-relative prefix (used after a verified local restore). */
export async function purgeObjects(prefix: string, target: StorageTarget = 'attachment'): Promise<number> {
  const config = await configFor(target);
  if (!objectStorageConfigured(config)) return 0;
  const s3 = client(config);
  let token: string | undefined;
  let deleted = 0;
  do {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: listPrefix(config, prefix),
      ContinuationToken: token,
      MaxKeys: 1000,
    }));
    const keys = (response.Contents ?? []).map((item) => ({ Key: item.Key! })).filter((item) => item.Key);
    if (keys.length) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: keys, Quiet: true },
      }));
      deleted += keys.length;
    }
    token = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

export async function listObjectEntries(prefix = '', limit = 500, target: StorageTarget = 'attachment'): Promise<Array<{ key: string; size: number; lastModified: string | null }>> {
  const config = await configFor(target);
  if (!objectStorageConfigured(config)) return [];
  const base = config.prefix.replace(/^\/+|\/+$/g, '');
  let token: string | undefined;
  const entries: Array<{ key: string; size: number; lastModified: string | null }> = [];
  do {
    const response = await client(config).send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: listPrefix(config, prefix),
      ContinuationToken: token,
      MaxKeys: Math.min(1000, limit - entries.length),
    }));
    for (const item of response.Contents ?? []) {
      if (!item.Key) continue;
      entries.push({
        key: base && item.Key.startsWith(`${base}/`) ? item.Key.slice(base.length + 1) : item.Key,
        size: item.Size ?? 0,
        lastModified: item.LastModified?.toISOString() ?? null,
      });
      if (entries.length >= limit) break;
    }
    token = entries.length < limit && response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token);
  return entries;
}

export async function testObjectStorage(config: ObjectStorageConfig): Promise<void> {
  if (!objectStorageConfigured(config)) throw new Error('对象存储配置不完整');
  await client(config).send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: config.prefix, MaxKeys: 1000 }));
}
