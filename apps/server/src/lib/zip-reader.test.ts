import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SafeZip } from './zip-reader.js';

const limits = {
  maxEntries: 10,
  maxEntryBytes: 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
  maxCompressionRatio: 500,
};

async function writeZip(build: (zip: AdmZip) => void): Promise<{ dir: string; file: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '360note-zip-'));
  const file = path.join(dir, 'test.zip');
  const zip = new AdmZip();
  build(zip);
  await fs.writeFile(file, zip.toBuffer());
  return { dir, file };
}

describe('SafeZip', () => {
  it('reads and copies entries without loading the archive', async () => {
    const body = crypto.randomBytes(64 * 1024);
    const { dir, file } = await writeZip((zip) => {
      zip.addFile('workspace.json', Buffer.from('{"ok":true}'));
      zip.addFile('attachments/a.bin', body);
    });
    const reader = await SafeZip.open(file, limits);
    try {
      expect(reader.has('workspace.json')).toBe(true);
      expect(JSON.parse((await reader.read('workspace.json')).toString('utf8'))).toEqual({ ok: true });
      const target = path.join(dir, 'copy.bin');
      const copied = await reader.copyToFile('attachments/a.bin', target);
      expect(copied.size).toBe(body.length);
      expect(copied.sha256).toBe(crypto.createHash('sha256').update(body).digest('hex'));
      expect((await fs.readFile(target)).equals(body)).toBe(true);
    } finally {
      reader.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects oversized entries', async () => {
    const large = await writeZip((zip) => zip.addFile('big.bin', Buffer.alloc(2048, 1)));
    await expect(SafeZip.open(large.file, { ...limits, maxEntryBytes: 128 })).rejects.toThrow(/单个文件过大/);
    await fs.rm(large.dir, { recursive: true, force: true });
  });
});
