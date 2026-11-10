import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import AdmZip from 'adm-zip';
import S3rver from 's3rver';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { hashPassword } from '../../apps/server/dist/lib/passwords.js';
import { decryptBuffer } from '../../apps/server/dist/lib/crypto.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const stamp = Date.now();
const dbName = `nh_s3_test_${stamp}`;
const dataDir = path.join('/tmp/opencode', `nh-s3-test-${stamp}`);
const port = 18000 + Math.floor(Math.random() * 1500);
const s3Port = 20000 + Math.floor(Math.random() * 1500);
const BASE = `http://127.0.0.1:${port}`;
const adminEmail = `s3test-${stamp}@invalid.local`;
const adminPassword = 'S3t!st-2026#ok';
const bucket = '360note-test';
let png;

const databaseUrl = (() => {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${dbName}`;
  return url.toString();
})();

let server;
let logFile;
let s3rver;
let pool;
let cookie = '';

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'pipe', ...options });
}

async function waitForHealth(timeout = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await delay(300);
  }
  throw new Error('test server did not start');
}

async function api(pathname, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (options.method && options.method !== 'GET' && options.method !== 'HEAD') headers['x-360note-csrf'] = '1';
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(options.json);
  }
  const response = await fetch(`${BASE}${pathname}`, { ...options, headers });
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${pathname} -> ${response.status} ${await response.text()}`);
  }
  return response;
}

async function waitForMigration(timeout = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const usage = await (await api('/api/admin/offsite/usage?force=1')).json();
    if (!usage.migration.running) {
      if (usage.migration.error) throw new Error(`migration failed: ${usage.migration.error}`);
      return usage;
    }
    await delay(400);
  }
  throw new Error('migration timed out');
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  png = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 220, g: 80, b: 40, alpha: 1 } } })
    .png()
    .toBuffer();
  run('sudo', ['-u', 'postgres', 'createdb', '-O', 'note360', dbName]);

  s3rver = new S3rver({
    port: s3Port,
    address: '127.0.0.1',
    silent: true,
    directory: path.join(dataDir, 's3'),
  });
  await s3rver.run();

  const s3 = new S3Client({
    region: 'us-east-1',
    endpoint: `http://127.0.0.1:${s3Port}`,
    forcePathStyle: true,
    credentials: { accessKeyId: 'S3RVER', secretAccessKey: 'S3RVER' },
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));

  logFile = await fs.open(path.join(dataDir, 'server.log'), 'a');
  server = spawn(process.execPath, ['apps/server/dist/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      PUBLIC_ORIGIN: BASE,
      NOTE360_DATA_DIR: dataDir,
      NOTE360_ENV_FILE: '/dev/null',
      OCR_ENABLED: 'false',
      TRUST_PROXY: 'false',
      REGISTRATION_MODE: 'open',
    },
    stdio: ['ignore', logFile.fd, logFile.fd],
  });
  await waitForHealth();

  pool = new pg.Pool({ connectionString: databaseUrl });
  const passwordHash = await hashPassword(adminPassword);
  const user = (await pool.query(
    `INSERT INTO users (email, display_name, password_hash, role, prefs)
     VALUES ($1, 'S3 test admin', $2, 'admin', '{}'::jsonb) RETURNING id`,
    [adminEmail, passwordHash],
  )).rows[0];
  const workspace = (await pool.query(
    `INSERT INTO workspaces (name, kind, owner_id) VALUES ('S3 test space', 'personal', $1) RETURNING id`,
    [user.id],
  )).rows[0];
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [workspace.id, user.id],
  );

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-360note-csrf': '1' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  assert.equal(login.status, 200, await login.text());
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');

  const note = (await (await api('/api/notes', {
    method: 'POST',
    json: { workspaceId: workspace.id, title: 'S3 attachment test', contentMd: 'body' },
  })).json()).note;

  async function uploadAttachment(name) {
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), name);
    const response = await api(`/api/notes/${note.id}/attachments`, { method: 'POST', body: form });
    return (await response.json()).attachment;
  }

  async function getContent(id, thumb = false) {
    const response = await api(`/api/attachments/${id}/content${thumb ? '?thumb=1' : ''}`);
    return { type: response.headers.get('content-type'), body: Buffer.from(await response.arrayBuffer()) };
  }

  async function attachmentKeys() {
    return (await pool.query(
      `SELECT id, storage_key FROM attachments WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [workspace.id],
    )).rows;
  }

  const first = await uploadAttachment('local.png');
  assert.equal((await attachmentKeys())[0].storage_key.includes('s3:'), false);
  const firstContent = await getContent(first.id);
  assert.deepEqual(firstContent.body, png);
  const firstThumb = await getContent(first.id, true);
  assert.equal(firstThumb.type, 'image/webp');
  console.log('PASS  local upload, original and thumbnail read');

  const s3Config = {
    enabled: true,
    endpoint: `http://127.0.0.1:${s3Port}`,
    region: 'us-east-1',
    bucket,
    prefix: '360note/',
    accessKeyId: 'S3RVER',
    secretAccessKey: 'S3RVER',
    forcePathStyle: true,
  };
  await api('/api/admin/offsite', { method: 'PUT', json: s3Config });
  await api('/api/admin/offsite/test', { method: 'POST' });
  const before = await (await api('/api/admin/offsite/usage?force=1')).json();
  assert.equal(before.configured, true);
  assert.equal(before.attachmentsEnabled, false);
  assert.ok(before.local.bytes > 0);
  console.log('PASS  S3 connection test and local usage');

  await api('/api/admin/offsite/attachments/enable', { method: 'POST' });
  let usage = await waitForMigration();
  assert.equal(usage.attachmentsEnabled, true);
  let keys = await attachmentKeys();
  assert.ok(keys.every((row) => row.storage_key.startsWith('s3:')));
  assert.deepEqual((await getContent(first.id)).body, png);
  assert.equal((await getContent(first.id, true)).type, 'image/webp');
  assert.ok(usage.remote.attachments.objects >= 2);
  await assert.rejects(api('/api/admin/offsite', { method: 'PUT', json: { ...s3Config, bucket: 'different-bucket' } }));
  const stillConfigured = await (await api('/api/admin/offsite')).json();
  assert.equal(stillConfigured.offsite.bucket, bucket);
  console.log('PASS  connection identity cannot change while attachments are remote');

  const second = await uploadAttachment('remote.png');
  keys = await attachmentKeys();
  const secondRow = keys.find((row) => row.id === second.id);
  assert.ok(secondRow.storage_key.startsWith('s3:'));
  assert.deepEqual((await getContent(second.id)).body, png);
  console.log('PASS  new upload goes directly to object storage');

  await api('/api/admin/offsite/attachments/disable', { method: 'POST', json: { purgeRemote: false } });
  usage = await waitForMigration();
  assert.equal(usage.attachmentsEnabled, false);
  keys = await attachmentKeys();
  assert.ok(keys.every((row) => !row.storage_key.startsWith('s3:')));
  assert.deepEqual((await getContent(first.id)).body, png);
  assert.deepEqual((await getContent(second.id)).body, png);
  assert.ok(usage.remote.attachments.objects >= 2);
  console.log('PASS  disable fetched every attachment back and kept remote copies');

  const remoteBefore = usage.remote.attachments;
  await api('/api/admin/offsite/attachments/enable', { method: 'POST' });
  usage = await waitForMigration();
  assert.equal(usage.attachmentsEnabled, true);
  assert.equal(usage.remote.attachments.objects, remoteBefore.objects);
  assert.equal(usage.remote.attachments.bytes, remoteBefore.bytes);
  console.log('PASS  re-enable skipped identical objects by path and size');

  const objectsBeforeDelete = usage.remote.attachments.objects;
  await api(`/api/attachments/${second.id}`, { method: 'DELETE' });
  usage = await (await api('/api/admin/offsite/usage?force=1')).json();
  assert.equal(usage.remote.attachments.objects, objectsBeforeDelete - 2);
  console.log('PASS  deleting a remote attachment removes original and thumbnail');

  await api('/api/admin/offsite/attachments/disable', { method: 'POST', json: { purgeRemote: true } });
  usage = await waitForMigration();
  assert.equal(usage.attachmentsEnabled, false);
  assert.equal(usage.remote.attachments.objects, 0);
  assert.equal(usage.remote.attachments.bytes, 0);
  assert.deepEqual((await getContent(first.id)).body, png);
  console.log('PASS  disable with purge restored locally and cleaned attachment objects');

  await api('/api/admin/offsite/attachments/enable', { method: 'POST' });
  usage = await waitForMigration();
  assert.equal(usage.attachmentsEnabled, true);
  const third = await uploadAttachment('remote-only.png');
  const thirdRow = (await attachmentKeys()).find((row) => row.id === third.id);
  assert.ok(thirdRow.storage_key.startsWith('s3:'));
  const thirdLocalKey = thirdRow.storage_key.replace(/^s3:attachments\//, '');
  await assert.rejects(fs.access(path.join(dataDir, 'attachments', thirdLocalKey)));
  console.log('PASS  remote-only attachment has no local file before full backup');

  const created = await (await api('/api/admin/instance-backups', { method: 'POST' })).json();
  const backups = await (await api('/api/admin/instance-backups')).json();
  const backup = backups.backups.find((item) => item.id === created.backup.id);
  assert.equal(backup.offsiteStatus, 'uploaded');
  usage = await (await api('/api/admin/offsite/usage?force=1')).json();
  assert.ok(usage.remote.backups.objects >= 1);
  const download = await api(`/api/admin/instance-backups/${backup.id}/download`);
  const archive = Buffer.from(await download.arrayBuffer());
  assert.ok(archive.length > 1000);
  const zip = new AdmZip(archive);
  const entry = zip.getEntry(`attachments/${thirdLocalKey}`);
  assert.ok(entry, `full-site backup is missing remote attachment ${thirdLocalKey}`);
  assert.deepEqual(decryptBuffer(entry.getData(), '360note:attachment'), png);
  console.log('PASS  full-site backup includes object-storage-only attachments');
  await api(`/api/admin/instance-backups/${backup.id}`, { method: 'DELETE' });
  usage = await (await api('/api/admin/offsite/usage?force=1')).json();
  assert.equal(usage.remote.backups.objects, 0);
  console.log('PASS  full-site backup uploads to object storage and deletes remotely');

  await api('/api/admin/offsite/attachments/disable', { method: 'POST', json: { purgeRemote: true } });
  await waitForMigration();
  await api(`/api/attachments/${third.id}`, { method: 'DELETE' });
  console.log('PASS  cleanup remote-only attachment and remote copies');

}

try {
  await main();
  console.log('ALL OBJECT STORAGE TESTS PASSED');
} catch (error) {
  console.error('TEST FAILED:', error);
  if (logFile) {
    const log = await fs.readFile(path.join(dataDir, 'server.log'), 'utf8').catch(() => '');
    console.error(log.split('\n').slice(-80).join('\n'));
  }
  process.exitCode = 1;
} finally {
  if (pool) await pool.end().catch(() => {});
  if (server) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(4000).then(() => server.kill('SIGKILL')),
    ]);
    await delay(200);
  }
  if (logFile) await logFile.close().catch(() => {});
  if (s3rver) await s3rver.close().catch(() => {});
  try {
    run('sudo', ['-u', 'postgres', 'dropdb', '--force', '--if-exists', dbName]);
  } catch (error) {
    console.error('dropdb failed', error.message);
  }
  await fs.rm(dataDir, { recursive: true, force: true });
}
