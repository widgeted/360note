import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decryptBuffer, decryptFile, encryptBuffer, encryptFile } from './crypto.js';

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), '360note-crypto-'));
}

describe('crypto', () => {
  it('round-trips v1 buffers', () => {
    const plain = crypto.randomBytes(4096);
    const encrypted = encryptBuffer(plain, 'test:aad');
    expect(encrypted[0]).toBe(1);
    expect(decryptBuffer(encrypted, 'test:aad').equals(plain)).toBe(true);
    expect(() => decryptBuffer(encrypted, 'wrong:aad')).toThrow();
  });

  it('streams v2 files and still reads legacy v1 payloads', async () => {
    const dir = await tempDir();
    try {
      const plainPath = path.join(dir, 'plain.bin');
      const encryptedPath = path.join(dir, 'encrypted.bin');
      const restoredPath = path.join(dir, 'restored.bin');
      const legacyPath = path.join(dir, 'legacy.bin');
      const legacyOut = path.join(dir, 'legacy-out.bin');
      const plain = crypto.randomBytes(2 * 1024 * 1024 + 13);
      await fs.writeFile(plainPath, plain);
      await encryptFile(plainPath, encryptedPath, 'test:file');
      expect((await fs.readFile(encryptedPath))[0]).toBe(2);
      await decryptFile(encryptedPath, restoredPath, 'test:file');
      expect((await fs.readFile(restoredPath)).equals(plain)).toBe(true);
      await expect(decryptFile(encryptedPath, path.join(dir, 'bad.bin'), 'wrong:aad')).rejects.toThrow();
      await expect(fs.stat(path.join(dir, 'bad.bin'))).rejects.toThrow();

      await fs.writeFile(legacyPath, encryptBuffer(plain.subarray(0, 8192), 'test:file'));
      await decryptFile(legacyPath, legacyOut, 'test:file');
      expect((await fs.readFile(legacyOut)).equals(plain.subarray(0, 8192))).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
