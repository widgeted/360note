import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { decryptString, encryptString } from '../lib/crypto.js';
import { paths } from '../config.js';
import { stat } from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { backupStorageKey, safeFilename } from '../lib/storage.js';
import { getSetting, setSetting } from './settings.js';

export interface OffsiteConfig {
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

interface StoredOffsite {
  enabled?: boolean;
  attachmentsEnabled?: boolean;
  endpoint?: string;
  region?: string;
  bucket?: string;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKeyEnc?: string;
  forcePathStyle?: boolean;
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastError?: string;
}

export async function getOffsiteConfig(): Promise<OffsiteConfig> {
  const stored = await getSetting<StoredOffsite>('offsite');
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

export async function saveOffsiteConfig(input: Partial<OffsiteConfig> & { secretAccessKey?: string }): Promise<void> {
  const existing = await getSetting<StoredOffsite>('offsite');
  const secret =
    input.secretAccessKey !== undefined && input.secretAccessKey !== ''
      ? encryptString(input.secretAccessKey, 'instance:offsite')
      : existing?.secretAccessKeyEnc ?? '';
  const value: StoredOffsite = {
    enabled: input.enabled ?? existing?.enabled ?? false,
    attachmentsEnabled: existing?.attachmentsEnabled ?? false,
    endpoint: input.endpoint ?? existing?.endpoint ?? '',
    region: input.region ?? existing?.region ?? 'auto',
    bucket: input.bucket ?? existing?.bucket ?? '',
    prefix: input.prefix ?? existing?.prefix ?? '360note/',
    accessKeyId: input.accessKeyId ?? existing?.accessKeyId ?? '',
    secretAccessKeyEnc: secret,
    forcePathStyle: input.forcePathStyle ?? existing?.forcePathStyle ?? true,
    lastTestAt: existing?.lastTestAt,
    lastTestOk: existing?.lastTestOk,
    lastError: existing?.lastError,
  };
  await setSetting('offsite', value as Record<string, unknown>);
}

function client(config: OffsiteConfig): S3Client {
  return new S3Client({
    region: config.region || 'auto',
    endpoint: config.endpoint || undefined,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

function keyFor(config: OffsiteConfig, filename: string): string {
  const prefix = config.prefix.replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${safeFilename(filename)}` : safeFilename(filename);
}

export async function testOffsite(config: OffsiteConfig): Promise<void> {
  if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error('S3 配置不完整');
  }
  const s3 = client(config);
  await s3.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: config.prefix, MaxKeys: 1000 }));
  await setSetting('offsite', {
    ...(await getSetting<Record<string, unknown>>('offsite')),
    lastTestAt: new Date().toISOString(),
    lastTestOk: true,
    lastError: null,
  });
}

export async function uploadOffsiteBackup(filename: string): Promise<'uploaded' | 'disabled' | 'failed'> {
  const config = await getOffsiteConfig();
  if (!config.enabled) return 'disabled';
  if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    await setSetting('offsite', {
      ...(await getSetting<Record<string, unknown>>('offsite')),
      lastTestAt: new Date().toISOString(),
      lastTestOk: false,
      lastError: 'S3 配置不完整，备份未上传',
    });
    return 'failed';
  }
  try {
    const filePath = path.join(paths.backups, backupStorageKey(filename));
    const fileStat = await stat(filePath);
    await client(config).send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: keyFor(config, filename),
        Body: fsSync.createReadStream(filePath),
        ContentLength: fileStat.size,
        ContentType: 'application/octet-stream',
        Metadata: { app: '360note', encryption: 'aes-256-gcm' },
      }),
    );
    await setSetting('offsite', {
      ...(await getSetting<Record<string, unknown>>('offsite')),
      lastTestAt: new Date().toISOString(),
      lastTestOk: true,
      lastError: null,
    });
    return 'uploaded';
  } catch (error) {
    console.error('[offsite] upload failed', error);
    await setSetting('offsite', {
      ...(await getSetting<Record<string, unknown>>('offsite')),
      lastTestAt: new Date().toISOString(),
      lastTestOk: false,
      lastError: (error as Error).message.slice(0, 500),
    });
    return 'failed';
  }
}

export async function deleteOffsiteBackup(filename: string): Promise<void> {
  const config = await getOffsiteConfig();
  if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) return;
  try {
    await client(config).send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: keyFor(config, filename) }),
    );
  } catch (error) {
    console.warn('[offsite] delete failed', filename, (error as Error).message);
  }
}

export async function offsitePublicConfig(): Promise<Record<string, unknown>> {
  const config = await getOffsiteConfig();
  const stored = (await getSetting<StoredOffsite>('offsite')) ?? {};
  return {
    enabled: config.enabled,
    attachmentsEnabled: config.attachmentsEnabled,
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    prefix: config.prefix,
    accessKeyId: config.accessKeyId,
    hasSecret: Boolean(stored.secretAccessKeyEnc),
    forcePathStyle: config.forcePathStyle,
    lastTestAt: stored.lastTestAt ?? null,
    lastTestOk: stored.lastTestOk ?? null,
    lastError: stored.lastError ?? null,
  };
}
