import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { parseImport } from './import-parser.js';

const tempDirs: string[] = [];

async function jobDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '360note-import-test-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('import parser', () => {
  it('parses markdown with folder path and title', async () => {
    const dir = await jobDir();
    const file = path.join(dir, 'note.md');
    await fs.writeFile(file, '# 测试标题\n\n正文 **加粗**。\n');
    const parsed = await parseImport({ jobDir: dir, uploads: [{ originalName: 'note.md', storedPath: file }] });
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0].title).toBe('测试标题');
    expect(parsed.notes[0].contentMd).toContain('正文');
  });

  it('parses a zip with an image attachment', async () => {
    const dir = await jobDir();
    const zip = new AdmZip();
    zip.addFile('项目/笔记.md', Buffer.from('# Zip 笔记\n\n![图](image.png)\n'));
    zip.addFile('项目/image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const file = path.join(dir, 'import.zip');
    zip.writeZip(file);
    const parsed = await parseImport({ jobDir: dir, uploads: [{ originalName: 'import.zip', storedPath: file }] });
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0].folderPath).toContain('项目');
    expect(parsed.notes[0].attachments).toHaveLength(1);
    expect(parsed.notes[0].contentMd).toContain('360note-attachment://');
  });

  it('strips Evernote XML prolog and parses tags', async () => {
    const dir = await jobDir();
    const file = path.join(dir, 'note.enex');
    await fs.writeFile(file, `<?xml version="1.0" encoding="UTF-8"?>
<en-export><note><title>ENEX 标题</title><content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "x"><en-note><h1>ENEX</h1><p>正文</p></en-note>]]></content><tag>evernote</tag><tag>import</tag></note></en-export>`);
    const parsed = await parseImport({ jobDir: dir, uploads: [{ originalName: 'note.enex', storedPath: file }] });
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0].title).toBe('ENEX 标题');
    expect(parsed.notes[0].contentMd).toContain('正文');
    expect(parsed.notes[0].contentMd).not.toContain('DOCTYPE');
    expect(parsed.notes[0].tags).toEqual(['evernote', 'import']);
  });

  it('converts CSV into a Markdown table', async () => {
    const dir = await jobDir();
    const file = path.join(dir, 'data.csv');
    await fs.writeFile(file, 'name,note\nAlice,"hello, world"\nBob,test\n');
    const parsed = await parseImport({ jobDir: dir, uploads: [{ originalName: 'data.csv', storedPath: file }] });
    expect(parsed.notes[0].contentMd).toContain('| name | note |');
    expect(parsed.notes[0].contentMd).toContain('Alice');
  });
});
