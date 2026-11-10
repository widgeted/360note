import * as yauzl from 'yauzl';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import { errors } from './errors.js';

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxCompressionRatio: number;
}

export interface ZipEntryInfo {
  name: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
}

/**
 * Minimal, streaming ZIP reader for backup archives.
 *
 * Unlike AdmZip, yauzl never loads the whole archive into memory: it reads the
 * central directory lazily and opens an entry stream on demand. Call close()
 * in a finally block.
 */
export class SafeZip {
  private readonly entries = new Map<string, yauzl.Entry>();
  private totalBytes = 0;
  private closed = false;

  private constructor(
    private readonly zip: yauzl.ZipFile,
    private readonly limits: ZipLimits,
  ) {}

  static async open(filePath: string, limits: ZipLimits): Promise<SafeZip> {
    const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
      yauzl.open(filePath, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, value) => {
        if (error || !value) reject(error ?? new Error('Unable to open ZIP'));
        else resolve(value);
      });
    });
    const reader = new SafeZip(zip, limits);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      zip.on('entry', (entry: yauzl.Entry) => {
        try {
          reader.acceptEntry(entry);
        } catch (error) {
          fail(error);
          return;
        }
        zip.readEntry();
      });
      zip.readEntry();
    });
    return reader;
  }

  private acceptEntry(entry: yauzl.Entry): void {
    const size = entry.uncompressedSize;
    const compressed = entry.compressedSize;
    if (!Number.isFinite(size) || size < 0 || !Number.isFinite(compressed) || compressed < 0) {
      throw errors.badRequest('备份文件已损坏');
    }
    if (this.entries.size + 1 > this.limits.maxEntries) {
      throw errors.badRequest('备份文件包含过多条目');
    }
    if (size > this.limits.maxEntryBytes) {
      throw errors.badRequest('备份文件中的单个文件过大');
    }
    this.totalBytes += size;
    if (this.totalBytes > this.limits.maxTotalBytes) {
      throw errors.badRequest('备份文件解压后过大');
    }
    if (size > 1024 * 1024 && (compressed === 0 || size / compressed > this.limits.maxCompressionRatio)) {
      throw errors.badRequest('备份文件压缩比异常');
    }
    if (entry.isEncrypted()) throw errors.badRequest('不支持加密的备份 ZIP');
    if (entry.fileName.startsWith('/') || entry.fileName.split('/').includes('..')) {
      throw errors.badRequest('备份文件包含不安全路径');
    }
    if (this.entries.has(entry.fileName)) {
      throw errors.badRequest('备份文件包含重复条目');
    }
    this.entries.set(entry.fileName, entry);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  list(): ZipEntryInfo[] {
    return [...this.entries.values()].map((entry) => ({
      name: entry.fileName,
      size: entry.uncompressedSize,
      compressedSize: entry.compressedSize,
      isDirectory: entry.fileName.endsWith('/'),
    }));
  }

  private entry(name: string): yauzl.Entry {
    const entry = this.entries.get(name);
    if (!entry) throw errors.badRequest(`备份缺少文件：${name}`);
    return entry;
  }

  async stream(name: string): Promise<Readable> {
    if (this.closed) throw new Error('ZIP reader is closed');
    return new Promise<Readable>((resolve, reject) => {
      this.zip.openReadStream(this.entry(name), (error, stream) => {
        if (error || !stream) reject(error ?? new Error('Unable to read ZIP entry'));
        else resolve(stream);
      });
    });
  }

  async read(name: string, maxBytes = this.limits.maxEntryBytes): Promise<Buffer> {
    const stream = await this.stream(name);
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for await (const chunk of stream) {
        const data = chunk as Buffer;
        total += data.length;
        if (total > maxBytes) throw errors.badRequest('备份文件中的单个文件过大');
        chunks.push(data);
      }
    } finally {
      stream.destroy();
    }
    return Buffer.concat(chunks, total);
  }

  async copyToFile(name: string, target: string, maxBytes = this.limits.maxEntryBytes): Promise<{ size: number; sha256: string }> {
    const stream = await this.stream(name);
    const output = fs.createWriteStream(target, { mode: 0o600, flags: 'wx' });
    const hash = crypto.createHash('sha256');
    let size = 0;
    try {
      for await (const chunk of stream) {
        const data = chunk as Buffer;
        size += data.length;
        if (size > maxBytes) throw errors.badRequest('备份文件中的单个文件过大');
        hash.update(data);
        if (!output.write(data)) await once(output, 'drain');
      }
      output.end();
      await once(output, 'finish');
      return { size, sha256: hash.digest('hex') };
    } catch (error) {
      stream.destroy();
      output.destroy();
      await fsp.rm(target, { force: true }).catch(() => {});
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.zip.close();
  }
}
