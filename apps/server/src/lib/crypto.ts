import crypto from 'node:crypto';
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
  if (payload.length < 30) throw new Error('Invalid encrypted payload');
  const version = payload[0];
  if (version !== 1) throw new Error('Unsupported encrypted payload version');
  const iv = payload.subarray(1, 13);
  const tag = payload.subarray(13, 29);
  const data = payload.subarray(29);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY(), iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
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
