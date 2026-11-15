#!/usr/bin/env node
/**
 * Encrypted-space integration test:
 * password-derived key, note/version/attachment encryption at rest, lock
 * enforcement, blocked share/comment/export/search, password change and
 * recovery-key rotation.
 *
 *   sudo bash -c 'set -a; source /etc/360note/360note.env; set +a;
 *     /opt/node22/bin/node tests/integration/encrypted-space.mjs'
 */
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import pg from 'pg';
import assert from 'node:assert/strict';

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) throw new Error('DATABASE_URL is required');
const stamp = Date.now();
const database = `note360_vault_${stamp}`;
const port = 8897;
const dataDir = `/tmp/opencode/vault-data-${stamp}`;
const dbUrl = new URL(baseDatabaseUrl);
dbUrl.pathname = `/${database}`;
const base = `http://127.0.0.1:${port}`;
const email = `vault-${stamp}@invalid.local`;
const password = 'K9m!tR4#vQ2@2026';
const vaultPassword = 'VaultPass!2026';
const masterKey = crypto.randomBytes(32).toString('base64');
let child = null;
let pool = null;

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

function responseCookies(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? ''];
}

function cookieNamed(response, name) {
  const match = responseCookies(response).find((value) => new RegExp(`(?:^|;)\\s*(?:__Host-)?${name}=`).test(value));
  return (match ?? '').split(';')[0];
}

async function req(path, { method = 'GET', cookie, body, vault } = {}) {
  const headers = { 'x-360note-csrf': '1', 'x-forwarded-for': '203.0.113.50' };
  if (cookie) headers.cookie = cookie;
  if (vault) headers['x-360note-vault'] = vault;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* binary or plain */
  }
  return { status: response.status, json, text, headers: response.headers };
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
    body: { email, displayName: 'Vault user', password, emailCode: '333333' },
  });
  assert.equal(registered.status, 200, registered.text);
  const cookie = cookieNamed(registered, 'nh_session');
  assert.ok(cookie);

  const created = await req('/api/workspaces', {
    method: 'POST',
    cookie,
    body: { name: 'Drill vault', kind: 'vault', vaultPassword },
  });
  assert.equal(created.status, 200, created.text);
  const workspaceId = created.json.workspace.id;
  assert.ok(created.json.recoveryKey?.startsWith('nhv1-'));
  assert.ok(created.json.vaultToken?.startsWith(`${workspaceId}.`));
  let vaultToken = created.json.vaultToken;

  const note = await req('/api/notes', {
    method: 'POST',
    cookie,
    vault: vaultToken,
    body: { workspaceId, title: 'PLAINTEXT-TITLE', contentMd: 'PLAINTEXT-BODY' },
  });
  assert.equal(note.status, 200, note.text);
  const noteId = note.json.note.id;
  assert.equal(note.json.note.title, 'PLAINTEXT-TITLE');
  assert.equal(note.json.note.contentMd, 'PLAINTEXT-BODY');

  const stored = (await pool.query(
    'SELECT title, content_md, excerpt, cipher_title, cipher_body, encrypted FROM notes WHERE id = $1',
    [noteId],
  )).rows[0];
  assert.equal(stored.title, '');
  assert.equal(stored.content_md, '');
  assert.equal(stored.excerpt, '');
  assert.equal(stored.encrypted, true);
  assert.match(stored.cipher_title, /^v1\./);
  assert.match(stored.cipher_body, /^v1\./);
  assert.ok(!stored.cipher_body.includes('PLAINTEXT-BODY'));

  const updated = await req(`/api/notes/${noteId}`, {
    method: 'PATCH',
    cookie,
    vault: vaultToken,
    body: { title: 'PLAINTEXT-TITLE-2', contentMd: 'PLAINTEXT-BODY-2', baseVersion: 1, reason: 'manual' },
  });
  assert.equal(updated.status, 200, updated.text);
  const versions = await req(`/api/notes/${noteId}/versions`, { cookie, vault: vaultToken });
  assert.equal(versions.status, 200, versions.text);
  assert.deepEqual(versions.json.versions.map((entry) => entry.preview), ['PLAINTEXT-BODY-2', 'PLAINTEXT-BODY']);
  const storedVersions = (await pool.query(
    'SELECT title, content_md FROM note_versions WHERE note_id = $1 ORDER BY version DESC',
    [noteId],
  )).rows;
  assert.ok(storedVersions.every((entry) => entry.title.startsWith('v1.') && entry.content_md.startsWith('v1.')));

  const form = new FormData();
  form.append('file', new Blob(['ATTACHMENT-PLAINTEXT'], { type: 'text/plain' }), 'secret-name.txt');
  const upload = await fetch(`${base}/api/notes/${noteId}/attachments`, {
    method: 'POST',
    headers: { cookie, 'x-360note-csrf': '1', 'x-360note-vault': vaultToken },
    body: form,
  });
  const uploadText = await upload.text();
  assert.equal(upload.status, 201, uploadText);
  const attachment = JSON.parse(uploadText).attachment;
  const attachmentRow = (await pool.query('SELECT filename FROM attachments WHERE id = $1', [attachment.id])).rows[0];
  assert.match(attachmentRow.filename, /^v1\./);
  assert.ok(!attachmentRow.filename.includes('secret-name'));

  const attachmentRead = await req(`/api/attachments/${attachment.id}/content`, { cookie, vault: vaultToken });
  assert.equal(attachmentRead.status, 200);
  assert.equal(attachmentRead.text, 'ATTACHMENT-PLAINTEXT');
  assert.equal(attachmentRead.headers.get('cache-control'), 'no-store');

  // Locked requests must fail even though the browser still has the session.
  assert.equal((await req(`/api/notes/${noteId}`, { cookie })).status, 423);
  assert.equal((await req(`/api/attachments/${attachment.id}/content`, { cookie })).status, 423);
  assert.equal((await req(`/api/folders?workspaceId=${workspaceId}`, { cookie })).status, 423);

  // Content features are disabled even while unlocked.
  assert.equal((await req(`/api/notes/${noteId}/shares`, { method: 'POST', cookie, vault: vaultToken, body: { permission: 'view' } })).status, 403);
  assert.equal((await req(`/api/notes/${noteId}/comments`, { method: 'POST', cookie, vault: vaultToken, body: { body: 'nope' } })).status, 403);
  assert.equal((await req(`/api/notes/${noteId}/export?format=md`, { cookie, vault: vaultToken })).status, 403);
  assert.equal((await req(`/api/search?workspaceId=${workspaceId}&q=PLAINTEXT`, { cookie, vault: vaultToken })).status, 400);
  assert.equal((await req(`/api/notes/offline-bundle?workspaceId=${workspaceId}`, { cookie, vault: vaultToken })).status, 400);
  assert.equal((await req(`/api/export?workspaceId=${workspaceId}&format=md`, { cookie, vault: vaultToken })).status, 403);

  // Wrong space password is not an account-session failure.
  const wrongUnlock = await req(`/api/workspaces/${workspaceId}/vault/unlock`, {
    method: 'POST',
    cookie,
    body: { password: 'wrong-password' },
  });
  assert.equal(wrongUnlock.status, 403, wrongUnlock.text);

  // Password change rotates the wrapping key and invalidates old passwords.
  const changed = await req(`/api/workspaces/${workspaceId}/vault/password`, {
    method: 'POST',
    cookie,
    vault: vaultToken,
    body: { currentPassword: vaultPassword, newPassword: 'VaultPass!2027' },
  });
  assert.equal(changed.status, 200, changed.text);
  vaultToken = changed.json.vaultToken;
  assert.ok(vaultToken);
  const oldPassword = await req(`/api/workspaces/${workspaceId}/vault/unlock`, {
    method: 'POST',
    cookie,
    body: { password: vaultPassword },
  });
  assert.equal(oldPassword.status, 403, oldPassword.text);

  // Recovery key rotates to a new one-time key and sets a new password.
  const recovery = await req(`/api/workspaces/${workspaceId}/vault/recovery`, {
    method: 'POST',
    cookie,
    body: { recoveryKey: created.json.recoveryKey, newPassword: 'VaultPass!2028' },
  });
  assert.equal(recovery.status, 200, recovery.text);
  assert.ok(recovery.json.recoveryKey?.startsWith('nhv1-'));
  assert.notEqual(recovery.json.recoveryKey, created.json.recoveryKey);
  vaultToken = recovery.json.vaultToken;
  const recoveredNote = await req(`/api/notes/${noteId}`, { cookie, vault: vaultToken });
  assert.equal(recoveredNote.status, 200, recoveredNote.text);
  assert.equal(recoveredNote.json.note.contentMd, 'PLAINTEXT-BODY-2');

  const locked = await req(`/api/workspaces/${workspaceId}/vault/lock`, { method: 'POST', cookie, vault: vaultToken });
  assert.equal(locked.status, 200, locked.text);
  assert.equal((await req(`/api/notes/${noteId}`, { cookie })).status, 423);

  const removed = await req(`/api/workspaces/${workspaceId}`, { method: 'DELETE', cookie });
  assert.equal(removed.status, 200, removed.text);
  console.log('PASS  encrypted space encrypts notes/versions/attachments, blocks sharing/search/export, rotates password and recovery key, and enforces locking');
}

try {
  await main();
} finally {
  await pool?.end().catch(() => {});
  if (child) child.kill('SIGTERM');
  await sleep(300);
  try {
    execFileSync('sudo', ['-u', 'postgres', 'dropdb', '--if-exists', database]);
  } catch {
    /* best effort */
  }
}
