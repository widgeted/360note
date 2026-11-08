import crypto from 'node:crypto';
import { safeEqual } from './crypto.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    output += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const value = B32.indexOf(char);
    if (value === -1) continue;
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function currentStep(period = 30): number {
  return Math.floor(Date.now() / 1000 / period);
}

export function totpCode(secret: string, at = Date.now()): string {
  return hotp(secret, Math.floor(at / 1000 / 30));
}

export function verifyTotp(secret: string, code: string, window = 1): { valid: boolean; step: number | null } {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return { valid: false, step: null };
  const step = currentStep();
  for (let offset = -window; offset <= window; offset++) {
    const candidate = hotp(secret, step + offset);
    if (safeEqual(candidate, normalized)) return { valid: true, step: step + offset };
  }
  return { valid: false, step: null };
}

export function otpauthUrl(secret: string, email: string, issuer = '360note'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const value = crypto.randomInt(0, 100_000_000);
    return String(value).padStart(8, '0').replace(/(\d{4})(\d{4})/, '$1-$2');
  });
}
