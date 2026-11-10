import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { once } from 'node:events';
import { config } from '../config.js';

function masterKey(): Buffer {
  if (config.masterKeyB64) {
    const key = Buffer.from(config.masterKeyB64, 'base64');
    if (key.length !== 32) throw new Error('NOTE360_MASTER_KEY must be 32 bytes base64');
    return key;
  }
  if (config.env === 'production') throw new Error('NOTE360_MASTER_KEY is required in production');
  return crypto.createHash('sha256').update('360note-development-master-key').digest();
}

export function validateCryptoConfig(): void {
  masterKey();
}

const KEY = () => masterKey();

/** AES-256-GCM. Format: [version=1][iv 12][tag 16][ciphertext]. */
export function encryptBuffer(plain: Buffer, aad = '360note'): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY(), iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, tag, encrypted]);
}

export function decryptBuffer(payload: Buffer, aad = '360note'): Buffer {
  if (payload.length < 29) throw new Error('Invalid encrypted payload');
  const version = payload[0];
  if (version !== 1 && version !== 2) throw new Error('Unsupported encrypted payload version');
  const iv = payload.subarray(1, 13);
  // v1 stores the tag before the ciphertext; v2 stores it after so both
  // encryption and decryption can run as streams.
  const tag = version === 1 ? payload.subarray(13, 29) : payload.subarray(payload.length - 16);
  const data = version === 1 ? payload.subarray(29) : payload.subarray(13, payload.length - 16);
  if (data.length === 0) throw new Error('Invalid encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY(), iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

async function writeAll(stream: fs.WriteStream, chunk: Buffer): Promise<void> {
  if (!chunk.length) return;
  if (!stream.write(chunk)) await once(stream, 'drain');
}

/** Streaming AES-256-GCM: [version=2][iv 12][ciphertext][tag 16]. */
export async function encryptFile(inputPath: string, outputPath: string, aad = '360note'): Promise<number> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY(), iv);
  cipher.setAAD(Buffer.from(aad));
  const write = fs.createWriteStream(outputPath, { mode: 0o600, flags: 'wx' });
  try {
    write.write(Buffer.from([2]));
    write.write(iv);
    for await (const chunk of fs.createReadStream(inputPath, { highWaterMark: 1024 * 1024 })) {
      await writeAll(write, cipher.update(chunk as Buffer));
    }
    await writeAll(write, cipher.final());
    write.end(cipher.getAuthTag());
    await once(write, 'finish');
    return (await fsp.stat(outputPath)).size;
  } catch (error) {
    write.destroy();
    await fsp.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  }
}

/** Decrypt a v1 or v2 payload to a file without holding the whole archive. */
export async function decryptFile(inputPath: string, outputPath: string, aad = '360note'): Promise<void> {
  const handle = await fsp.open(inputPath, 'r');
  let version: number;
  try {
    const header = Buffer.alloc(1);
    await handle.read(header, 0, 1, 0);
    version = header[0];
  } finally {
    await handle.close();
  }
  if (version === 1) {
    const plain = decryptBuffer(await fsp.readFile(inputPath), aad);
    await fsp.writeFile(outputPath, plain, { mode: 0o600 });
    return;
  }
  if (version !== 2) throw new Error('Unsupported encrypted payload version');
  const size = (await fsp.stat(inputPath)).size;
  if (size < 30) throw new Error('Invalid encrypted payload');
  const ivHandle = await fsp.open(inputPath, 'r');
  let iv: Buffer;
  let tag: Buffer;
  try {
    iv = Buffer.alloc(12);
    tag = Buffer.alloc(16);
    await ivHandle.read(iv, 0, 12, 1);
    await ivHandle.read(tag, 0, 16, size - 16);
  } finally {
    await ivHandle.close();
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY(), iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  const write = fs.createWriteStream(outputPath, { mode: 0o600, flags: 'wx' });
  try {
    for await (const chunk of fs.createReadStream(inputPath, { start: 13, end: size - 17, highWaterMark: 1024 * 1024 })) {
      await writeAll(write, decipher.update(chunk as Buffer));
    }
    await writeAll(write, decipher.final());
    write.end();
    await once(write, 'finish');
  } catch (error) {
    write.destroy();
    await fsp.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function encryptString(plain: string, aad = '360note'): string {
  return encryptBuffer(Buffer.from(plain, 'utf8'), aad).toString('base64');
}

export function decryptString(payload: string, aad = '360note'): string {
  return decryptBuffer(Buffer.from(payload, 'base64'), aad).toString('utf8');
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function randomId(): string {
  return crypto.randomUUID();
}

export function randomDigits(length: number): string {
  let output = '';
  while (output.length < length) output += crypto.randomInt(0, 10).toString();
  return output;
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateRecoveryKey(): string {
  const raw = Array.from({ length: 20 }, () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]).join('');
  return raw.match(/.{1,4}/g)!.join('-');
}

export function normalizeRecoveryKey(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryKey(key: string): string {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(normalizeRecoveryKey(key))
    .digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

interface SignedTokenPayload {
  typ: string;
  [key: string]: unknown;
  exp: number;
}

type SignedTokenInput = { typ: string; [key: string]: unknown; exp?: number };

export function signToken(payload: SignedTokenInput, ttlSeconds = 300): string {
  const body: SignedTokenPayload = {
    ...payload,
    exp: payload.exp ?? Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.sessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyToken<T extends Record<string, unknown> = Record<string, unknown>>(token: string): (T & { typ: string; exp: number }) | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(encoded).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T & { typ: string; exp: number };
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
