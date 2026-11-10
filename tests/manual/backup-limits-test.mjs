#!/usr/bin/env node
/**
 * Resource-limit regression tests for attacker-controlled .3nb archives.
 * Run from /opt/360note after `npm run build -w @360note/server`.
 */
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { previewBackup, BACKUP_LIMITS } from '../../apps/server/dist/services/backups.js';

const validDocument = {
  format: '360note-backup',
  version: 1,
  createdAt: new Date().toISOString(),
  workspace: { id: '11111111-1111-4111-8111-111111111111', name: 'Test workspace' },
  counts: { notes: 0, folders: 0, tags: 0, attachments: 0 },
  folders: [],
  tags: [],
  notes: [],
  noteTags: [],
  attachments: [],
  versions: [],
  comments: [],
};

function validZip() {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ format: '360note-backup', version: 1 })));
  zip.addFile('workspace.json', Buffer.from(JSON.stringify(validDocument)));
  return zip;
}

// A legitimate small backup still previews.
const ok = previewBackup(validZip().toBuffer(), validDocument.workspace.id);
assert.equal(ok.format, '360note-backup');
console.log('PASS  valid backup previews');

// Too many entries is rejected before any entry is decompressed.
const many = new AdmZip();
for (let index = 0; index < BACKUP_LIMITS.maxEntries + 1; index += 1) {
  many.addFile(`f/${index}.txt`, Buffer.alloc(0));
}
assert.throws(
  () => previewBackup(many.toBuffer(), validDocument.workspace.id),
  /备份文件包含过多条目|too many entries/i,
);
console.log('PASS  excessive entry count rejected');

// A highly compressible large entry is treated as a zip bomb.
const bomb = new AdmZip();
bomb.addFile('manifest.json', Buffer.from(JSON.stringify({ format: '360note-backup', version: 1 })));
bomb.addFile('workspace.json', Buffer.from(JSON.stringify(validDocument)));
bomb.addFile('bomb.bin', Buffer.alloc(2 * 1024 * 1024, 0));
assert.throws(
  () => previewBackup(bomb.toBuffer(), validDocument.workspace.id),
  /压缩比异常|compression ratio/i,
);
console.log('PASS  abnormal compression ratio rejected');

// A single oversized entry is rejected.
const large = new AdmZip();
large.addFile('manifest.json', Buffer.from(JSON.stringify({ format: '360note-backup', version: 1 })));
large.addFile('workspace.json', Buffer.from(JSON.stringify(validDocument)));
large.addFile('large.bin', Buffer.alloc(BACKUP_LIMITS.maxEntryBytes + 1, 1));
assert.throws(
  () => previewBackup(large.toBuffer(), validDocument.workspace.id),
  /单个文件过大|file inside the backup is too large/i,
);
console.log('PASS  oversized entry rejected');

// A structurally invalid document is rejected as bad input, not 500.
const invalid = new AdmZip();
invalid.addFile('manifest.json', Buffer.from(JSON.stringify({ format: '360note-backup', version: 1 })));
invalid.addFile('workspace.json', Buffer.from(JSON.stringify({ format: '360note-backup', version: 1 })));
assert.throws(
  () => previewBackup(invalid.toBuffer(), validDocument.workspace.id),
  /内容无法解析|could not be parsed/i,
);
console.log('PASS  invalid document shape rejected');

console.log(`\nBackup limits: ${BACKUP_LIMITS.maxEntries} entries, ${BACKUP_LIMITS.maxEntryBytes} B/entry, ${BACKUP_LIMITS.maxTotalBytes} B total, ratio ${BACKUP_LIMITS.maxCompressionRatio}`);
