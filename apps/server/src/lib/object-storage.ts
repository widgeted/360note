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
import { decryptString } from './crypto.js';
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

export async function getObjectStorageConfig(): Promise<ObjectStorageConfig> {
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

export async function setAttachmentsEnabledSetting(value: boolean): Promise<void> {
  const stored = (await getSetting<Record<string, unknown>>('offsite')) ?? {};
  await setSetting('offsite', { ...stored, attachmentsEnabled: value });
}

export function objectStorageConfigured(config: ObjectStorageConfig): boolean {
  return Boolean(config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey);
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

export async function putObject(storageKey: string, data: Buffer, contentType = 'application/octet-stream'): Promise<void> {
  const config = await getObjectStorageConfig();
  if (!objectStorageConfigured(config)) throw new Error('对象存储配置不完整');
  await client(config).send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: keyFor(config, storageKey),
    Body: data,
    ContentType: contentType,
    Metadata: { app: '360note', encryption: 'aes-256-gcm' },
  }));
}

export async function putObjectStream(
  storageKey: string,
  body: Readable,
  contentLength: number,
  contentType = 'application/octet-stream',
): Promise<void> {
  const config = await getObjectStorageConfig();
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

export async function getObject(storageKey: string): Promise<Buffer> {
  const config = await getObjectStorageConfig();
  if (!objectStorageConfigured(config)) throw new Error('对象存储配置不完整');
  const response = await client(config).send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: keyFor(config, storageKey),
  }));
  if (!response.Body) throw new Error('对象存储返回为空');
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function deleteObject(storageKey: string): Promise<void> {
  const config = await getObjectStorageConfig();
  if (!objectStorageConfigured(config)) return;
  await client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: keyFor(config, storageKey) }));
}

export async function headObject(storageKey: string): Promise<{ exists: boolean; size: number; etag: string | null }> {
  const config = await getObjectStorageConfig();
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

export async function objectExists(storageKey: string): Promise<boolean> {
  return (await headObject(storageKey)).exists;
}

function listPrefix(config: ObjectStorageConfig, prefix: string): string {
  const base = config.prefix.replace(/^\/+|\/+$/g, '');
  if (!prefix) return base ? `${base}/` : '';
  return base ? `${base}/${prefix}` : prefix;
}

/** List app-relative keys (the prefix itself is stripped). */
export async function listObjectKeys(prefix = ''): Promise<string[]> {
  const config = await getObjectStorageConfig();
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

export async function objectUsage(prefix = 'attachments/'): Promise<{ objects: number; bytes: number }> {
  const config = await getObjectStorageConfig();
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
export async function purgeObjects(prefix: string): Promise<number> {
  const config = await getObjectStorageConfig();
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

export async function listObjectEntries(prefix = '', limit = 500): Promise<Array<{ key: string; size: number; lastModified: string | null }>> {
  const config = await getObjectStorageConfig();
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
