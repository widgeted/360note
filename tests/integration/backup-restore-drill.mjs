#!/usr/bin/env node
/**
 * Backup restore drill against a throwaway database and API process:
 * create data -> create backup -> preview/download -> delete -> upload ->
 * merge restore -> verify content. Also exercises backup job idempotency and
 * post-write integrity verification.
 *
 *   sudo bash -c 'set -a; source /etc/360note/360note.env; set +a;
 *     /opt/node22/bin/node tests/integration/backup-restore-drill.mjs'
 */
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import assert from 'node:assert/strict';

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) throw new Error('DATABASE_URL is required');
const stamp = Date.now();
const database = `note360_drill_${stamp}`;
const port = 8899;
const dataDir = `/tmp/opencode/drill-data-${stamp}`;
const dbUrl = new URL(baseDatabaseUrl);
dbUrl.pathname = `/${database}`;
const base = `http://127.0.0.1:${port}`;
const email = `drill-${stamp}@invalid.local`;
const password = 'K9m!tR4#vQ2@2026';
const masterKey = crypto.randomBytes(32).toString('base64');
let child = null;
let pool = null;

process.env.DATABASE_URL = dbUrl.toString();
process.env.NODE_ENV = 'test';
process.env.NOTE360_DATA_DIR = dataDir;
process.env.NOTE360_ENV_FILE = '/tmp/opencode/nonexistent.env';
process.env.NOTE360_MASTER_KEY = masterKey;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function waitForHealth(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`API exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      /* not ready */
    }
    await sleep(250);
  }
  throw new Error('API did not become healthy');
}

async function req(path, { method = 'GET', cookie, body } = {}) {
  const headers = { 'x-360note-csrf': '1', 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200) + 20}` };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* binary or plain text */
  }
  return { status: response.status, json, text, headers: response.headers, response };
}

async function waitForJob(cookie, jobId) {
  let job = null;
  for (let index = 0; index < 120; index += 1) {
    const response = await req(`/api/jobs/${jobId}`, { cookie });
    job = response.json?.job;
    if (job?.status === 'done' || job?.status === 'error') return job;
    await sleep(250);
  }
  throw new Error(`job ${jobId} did not finish: ${JSON.stringify(job)}`);
}

async function main() {
  execFileSync('sudo', ['-u', 'postgres', 'createdb', '-O', 'note360', database]);
  child = spawn('/opt/node22/bin/node', ['apps/server/dist/index.js'], {
    cwd: '/opt/360note',
    env: {
      ...process.env,
      DATABASE_URL: dbUrl.toString(),
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      PUBLIC_ORIGIN: base,
      NOTE360_DATA_DIR: dataDir,
      WEB_DIST: '/opt/360note/apps/web/dist',
      NOTE360_ENV_FILE: '/tmp/opencode/nonexistent.env',
      SMTP_HOST: '',
      REGISTRATION_MODE: 'open',
      NOTE360_MASTER_KEY: masterKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  pool = new pg.Pool({ connectionString: dbUrl.toString(), max: 5 });

  await pool.query(
    `INSERT INTO email_codes (email, purpose, code_hash, expires_at)
     VALUES ($1, 'register', $2, now() + interval '10 minutes')`,
    [email, sha256(`register:${email}:333333`)],
  );
  const registered = await req('/api/auth/register', {
    method: 'POST',
    body: { email, displayName: 'Drill user', password, emailCode: '333333' },
  });
  assert.equal(registered.status, 200, registered.text);
  const setCookies = typeof registered.headers.getSetCookie === 'function'
    ? registered.headers.getSetCookie()
    : [registered.headers.get('set-cookie') ?? ''];
  const cookie = (setCookies.find((value) => value.includes('nh_session')) ?? setCookies[0] ?? '').split(';')[0];
  const workspace = registered.json.workspaces.find((entry) => entry.kind === 'personal');
  assert.ok(workspace?.id);

  const created = await req('/api/notes', {
    method: 'POST',
    cookie,
    body: { workspaceId: workspace.id, title: 'Drill note', contentMd: '# Drill\n\nzqxmd restore me', tagNames: ['drill'] },
  });
  assert.equal(created.status, 200, created.text);
  const noteId = created.json.note.id;

  const attachmentForm = new FormData();
  attachmentForm.append('file', new Blob(['attachment-restore-marker'], { type: 'text/plain' }), 'marker.txt');
  const attachmentResponse = await fetch(`${base}/api/notes/${noteId}/attachments`, {
    method: 'POST',
    headers: { cookie, 'x-360note-csrf': '1' },
    body: attachmentForm,
  });
  const attachmentJson = await attachmentResponse.json();
  assert.equal(attachmentResponse.status, 201, JSON.stringify(attachmentJson));
  assert.ok(attachmentJson.attachment?.id, 'attachment upload failed');

  const backupJobId = (await req(`/api/workspaces/${workspace.id}/backups`, { method: 'POST', cookie })).json.jobId;
  const backupJob = await waitForJob(cookie, backupJobId);
  assert.equal(backupJob.status, 'done', JSON.stringify(backupJob));
  const list = await req(`/api/workspaces/${workspace.id}/backups`, { cookie });
  const backup = list.json.backups.find((entry) => entry.kind === 'manual');
  assert.ok(backup?.id, 'manual backup not listed');

  const preview = await req(`/api/backups/${backup.id}/preview?workspaceId=${workspace.id}`, { cookie });
  assert.equal(preview.status, 200, preview.text);
  assert.ok(preview.json.preview.counts.notes >= 1);

  const download = await fetch(`${base}/api/backups/${backup.id}/download?workspaceId=${workspace.id}`, {
    headers: { cookie, 'x-360note-csrf': '1' },
  });
  assert.equal(download.status, 200);
  const archive = Buffer.from(await download.arrayBuffer());
  assert.ok(archive.length > 100, 'downloaded archive is empty');

  // Replace over a live workspace with an existing attachment. This is the
  // exact path that used to fail with EEXIST before atomic file replacement.
  const liveForm = new FormData();
  liveForm.append('file', new Blob([archive], { type: 'application/zip' }), 'drill-live.3nb');
  const liveUploadResponse = await fetch(`${base}/api/workspaces/${workspace.id}/backups/upload`, {
    method: 'POST',
    headers: { cookie, 'x-360note-csrf': '1' },
    body: liveForm,
  });
  const liveUpload = await liveUploadResponse.json();
  assert.equal(liveUploadResponse.status, 200, JSON.stringify(liveUpload));
  const liveRestore = await req(`/api/backups/uploads/${liveUpload.uploadId}/restore`, {
    method: 'POST',
    cookie,
    body: { mode: 'replace' },
  });
  assert.equal(liveRestore.status, 200, liveRestore.text);
  const liveJob = await waitForJob(cookie, liveRestore.json.jobId);
  assert.equal(liveJob.status, 'done', JSON.stringify(liveJob));
  const liveNote = await req(`/api/notes/${noteId}`, { cookie });
  assert.equal(liveNote.status, 200);
  const liveAttachment = liveNote.json.note.attachments?.find((entry) => entry.filename === 'marker.txt');
  assert.ok(liveAttachment?.id);
  const liveContent = await fetch(`${base}/api/attachments/${liveAttachment.id}/content`, { headers: { cookie } });
  assert.equal(liveContent.status, 200);
  assert.equal(await liveContent.text(), 'attachment-restore-marker');
  console.log('PASS  live workspace replace restore keeps existing attachments readable');

  const trashed = await req(`/api/notes/${noteId}`, { method: 'DELETE', cookie });
  assert.equal(trashed.status, 200, trashed.text);
  const purged = await req(`/api/notes/${noteId}/permanent`, { method: 'DELETE', cookie });
  assert.equal(purged.status, 200, purged.text);
  const missing = await req(`/api/search?workspaceId=${workspace.id}&q=zqxmd`, { cookie });
  assert.equal(missing.json.notes.length, 0, `note should be gone before restore: ${JSON.stringify(missing.json.notes)}`);
  console.log('PASS  backup created, previewed, downloaded and note removed');

  const form = new FormData();
  form.append('file', new Blob([archive], { type: 'application/zip' }), 'drill.3nb');
  const uploadResponse = await fetch(`${base}/api/workspaces/${workspace.id}/backups/upload`, {
    method: 'POST',
    headers: { cookie, 'x-360note-csrf': '1' },
    body: form,
  });
  const upload = await uploadResponse.json();
  assert.equal(uploadResponse.status, 200, JSON.stringify(upload));
  assert.ok(upload.uploadId, 'upload id missing');
  assert.ok(upload.preview?.counts?.notes >= 1);

  const restore = await req(`/api/backups/uploads/${upload.uploadId}/restore`, {
    method: 'POST',
    cookie,
    body: { mode: 'merge' },
  });
  assert.equal(restore.status, 200, restore.text);
  const restoreJob = await waitForJob(cookie, restore.json.jobId);
  assert.equal(restoreJob.status, 'done', JSON.stringify(restoreJob));

  const restored = await req(`/api/search?workspaceId=${workspace.id}&q=zqxmd`, { cookie });
  assert.ok(restored.json.notes.length >= 1, 'restored note missing');
  const restoredNote = await req(`/api/notes/${restored.json.notes[0].id}`, { cookie });
  assert.match(restoredNote.json.note.contentMd, /restore me/);
  const restoredAttachment = restoredNote.json.note.attachments?.find((entry) => entry.filename === 'marker.txt');
  assert.ok(restoredAttachment?.id, 'attachment missing after restore');
  const attachmentContent = await fetch(`${base}/api/attachments/${restoredAttachment.id}/content`, { headers: { cookie } });
  assert.equal(attachmentContent.status, 200);
  assert.equal(await attachmentContent.text(), 'attachment-restore-marker');
  console.log('PASS  uploaded backup restored, including attachment content');

  // Replace restore uses the same streaming ZIP reader but stages attachments
  // straight into the attachment store instead of the import pipeline.
  const replaceForm = new FormData();
  replaceForm.append('file', new Blob([archive], { type: 'application/zip' }), 'drill-replace.3nb');
  const replaceUploadResponse = await fetch(`${base}/api/workspaces/${workspace.id}/backups/upload`, {
    method: 'POST',
    headers: { cookie, 'x-360note-csrf': '1' },
    body: replaceForm,
  });
  const replaceUpload = await replaceUploadResponse.json();
  assert.equal(replaceUploadResponse.status, 200, JSON.stringify(replaceUpload));
  const replaceRestore = await req(`/api/backups/uploads/${replaceUpload.uploadId}/restore`, {
    method: 'POST',
    cookie,
    body: { mode: 'replace' },
  });
  assert.equal(replaceRestore.status, 200, replaceRestore.text);
  const replaceJob = await waitForJob(cookie, replaceRestore.json.jobId);
  assert.equal(replaceJob.status, 'done', JSON.stringify(replaceJob));
  const replaced = await req(`/api/search?workspaceId=${workspace.id}&q=zqxmd`, { cookie });
  assert.ok(replaced.json.notes.length >= 1, 'replace restore lost the note');
  const replacedNote = await req(`/api/notes/${replaced.json.notes[0].id}`, { cookie });
  const replacedAttachment = replacedNote.json.note.attachments?.find((entry) => entry.filename === 'marker.txt');
  assert.ok(replacedAttachment?.id, 'replace restore lost the attachment');
  const replacedContent = await fetch(`${base}/api/attachments/${replacedAttachment.id}/content`, { headers: { cookie } });
  assert.equal(replacedContent.status, 200);
  assert.equal(await replacedContent.text(), 'attachment-restore-marker');
  console.log('PASS  replace restore streams attachments back into storage');

  // Direct idempotency/verification check using the same data directory.
  const { createBackup } = await import('../../apps/server/dist/services/backups.js');
  const { one, closePool } = await import('../../apps/server/dist/db.js');
  const userRow = await one('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  const idempotentJob = crypto.randomUUID();
  await queryJob(idempotentJob, workspace.id, userRow.id);
  const first = await createBackup({ workspaceId: workspace.id, userId: userRow.id, kind: 'manual', jobId: idempotentJob });
  const second = await createBackup({ workspaceId: workspace.id, userId: userRow.id, kind: 'manual', jobId: idempotentJob });
  assert.equal(second.id, first.id, 'same job id must return the same backup');
  const rows = await one('SELECT count(*)::int AS count FROM backups WHERE job_id = $1', [idempotentJob]);
  assert.equal(rows.count, 1);
  await closePool();
  console.log('PASS  backup job idempotency returns one verified archive');
}

async function queryJob(jobId, workspaceId, userId) {
  await pool.query(
    `INSERT INTO jobs (id, type, status, payload, created_by)
     VALUES ($1, 'backup-create', 'queued', $2::jsonb, $3)`,
    [jobId, JSON.stringify({ workspaceId }), userId],
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (child) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    if (pool) await pool.end().catch(() => {});
    try {
      execFileSync('sudo', ['-u', 'postgres', 'dropdb', '--if-exists', database]);
    } catch (error) {
      console.error('failed to drop drill database', error.message);
    }
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });
