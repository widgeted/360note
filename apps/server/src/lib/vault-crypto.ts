import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { sha256 } from './crypto.js';

const scryptAsync = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const PREFIX = 'v1';

export function randomVaultKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}

export function randomVaultSalt(): Buffer {
  return crypto.randomBytes(16);
}

/** Derive the key-encryption key from the space password. */
export async function deriveVaultKek(password: string, salt: Buffer): Promise<Buffer> {
  return scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: 128 * 1024 * 1024,
  });
}

function seal(key: Buffer, plain: Buffer, aad: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function open(key: Buffer, payload: string, aad: string): Buffer {
  const [version, ivB64, tagB64, dataB64] = String(payload || '').split('.');
  if (version !== PREFIX || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error('Invalid encrypted vault payload');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
}

export function wrapVaultKey(dataKey: Buffer, kek: Buffer, aad: string): string {
  return seal(kek, dataKey, aad);
}

export function unwrapVaultKey(wrapped: string, kek: Buffer, aad: string): Buffer {
  const dataKey = open(kek, wrapped, aad);
  if (dataKey.length !== KEY_LENGTH) throw new Error('Invalid vault data key');
  return dataKey;
}

export function encryptVaultText(dataKey: Buffer, text: string, aad: string): string {
  return seal(dataKey, Buffer.from(text ?? '', 'utf8'), aad);
}

export function decryptVaultText(dataKey: Buffer, payload: string | null | undefined, aad: string): string {
  if (!payload) return '';
  return open(dataKey, payload, aad).toString('utf8');
}

export function encryptVaultBuffer(dataKey: Buffer, data: Buffer, aad: string): Buffer {
  const sealed = seal(dataKey, data, aad);
  return Buffer.from(sealed, 'utf8');
}

export function decryptVaultBuffer(dataKey: Buffer, payload: Buffer, aad: string): Buffer {
  return open(dataKey, payload.toString('utf8'), aad);
}

export function vaultKeyAad(workspaceId: string): string {
  return `vault-key:${workspaceId}`;
}

export function vaultRecoveryAad(workspaceId: string): string {
  return `vault-recovery:${workspaceId}`;
}

export function vaultNoteTitleAad(workspaceId: string, noteId: string): string {
  return `vault-note:${workspaceId}:${noteId}:title`;
}

export function vaultNoteBodyAad(workspaceId: string, noteId: string): string {
  return `vault-note:${workspaceId}:${noteId}:body`;
}

export function vaultVersionTitleAad(workspaceId: string, noteId: string): string {
  return `vault-version:${workspaceId}:${noteId}:title`;
}

export function vaultVersionBodyAad(workspaceId: string, noteId: string): string {
  return `vault-version:${workspaceId}:${noteId}:body`;
}

export function vaultAttachmentAad(workspaceId: string, attachmentId: string): string {
  return `vault-attachment:${workspaceId}:${attachmentId}`;
}

export function vaultFilenameAad(workspaceId: string, attachmentId: string): string {
  return `vault-filename:${workspaceId}:${attachmentId}`;
}

export function generateVaultRecoveryKey(): string {
  return `nhv1-${crypto.randomBytes(32).toString('base64url')}`;
}

export function normalizeRecoveryKey(value: string): string {
  return value.trim().replace(/\s+/g, '');
}

export function recoveryKeyHash(value: string): string {
  return sha256(`vault-recovery:${normalizeRecoveryKey(value)}`);
}

/** Recovery keys are already 256-bit random; a direct hash is enough for wrapping. */
export function recoveryKek(value: string): Buffer {
  return crypto.createHash('sha256').update(`vault-recovery-kek:${normalizeRecoveryKey(value)}`).digest();
}
