#!/usr/bin/env node
/**
 * Concurrency regressions for note saves and TOTP/backup-code consumption.
 * Creates temporary users and removes them afterwards. It does not send email.
 *
 * Required env: DATABASE_URL, BASE_URL
 * Run as the service owner or root from /opt/360note.
 */
import pg from 'pg';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { hashPassword } from '../../apps/server/dist/lib/passwords.js';
import { encryptString, sha256 } from '../../apps/server/dist/lib/crypto.js';
import { generateTotpSecret, totpCode } from '../../apps/server/dist/lib/totp.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const TEST_CLIENT_IP = `198.51.100.${crypto.randomInt(1, 254)}`;
const userIds = [];
const workspaceIds = [];

async function request(pathname, options = {}) {
  const headers = { ...(options.headers ?? {}), 'x-forwarded-for': TEST_CLIENT_IP };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.method && options.method !== 'GET') headers['x-360note-csrf'] = '1';
  let body = options.body;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${pathname}`, { method: options.method ?? 'GET', headers, body });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function createUser(label) {
  const email = `conc-${label}-${stamp}@invalid.local`;
  const password = 'K9m!tR4#vQ2@2026';
  const user = await pool.query(
    `INSERT INTO users (email, display_name, password_hash, role, avatar_color, email_verified_at)
     VALUES ($1, $2, $3, 'user', '#157a52', now()) RETURNING id, email`,
    [email, `Concurrency ${label}`, await hashPassword(password)],
  );
  userIds.push(user.rows[0].id);
  return { ...user.rows[0], password };
}

async function loginPassword(email, password) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(response.status, 200, `password login failed: ${response.status} ${response.text}`);
  return response;
}

async function main() {
  // ---- concurrent note saves ----
  const saveUser = await createUser('save');
  const login = await loginPassword(saveUser.email, saveUser.password);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const workspace = await request('/api/workspaces', {
    method: 'POST',
    cookie,
    body: { name: `Concurrency space ${stamp}`, kind: 'personal', icon: '📔', color: '#157a52' },
  });
  assert.equal(workspace.status, 200);
  workspaceIds.push(workspace.json.workspace.id);
  const note = await request('/api/notes', {
    method: 'POST',
    cookie,
    body: { workspaceId: workspace.json.workspace.id, title: 'Concurrent note', contentMd: 'base' },
  });
  assert.equal(note.status, 200);
  const noteId = note.json.note.id;
  const baseVersion = note.json.note.version;

  const [left, right] = await Promise.all([
    request(`/api/notes/${noteId}`, {
      method: 'PATCH',
      cookie,
      body: { baseVersion, title: 'Concurrent note', contentMd: 'writer A' },
    }),
    request(`/api/notes/${noteId}`, {
      method: 'PATCH',
      cookie,
      body: { baseVersion, title: 'Concurrent note', contentMd: 'writer B' },
    }),
  ]);
  const statuses = [left.status, right.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409], `expected one 200 and one 409, got ${statuses.join(',')}`);
  const finalNote = await request(`/api/notes/${noteId}`, { cookie });
  assert.equal(finalNote.status, 200);
  assert.equal(finalNote.json.note.version, baseVersion + 1);
  assert.ok(['writer A', 'writer B'].includes(finalNote.json.note.contentMd.replace(/^#*\s*/, '').slice(0, 20)) || finalNote.json.note.contentMd.includes('writer'));
  console.log('PASS  concurrent save: one commit, one 409, version incremented once');

  // ---- atomic failed-login counter ----
  const limitUser = await createUser('limit');
  await Promise.all(
    Array.from({ length: 5 }, () =>
      request('/api/auth/login', {
        method: 'POST',
        body: { email: limitUser.email, password: 'wrong-password' },
      }),
    ),
  );
  const failedCounter = await pool.query('SELECT failed_logins FROM users WHERE id = $1', [limitUser.id]);
  assert.ok(Number(failedCounter.rows[0].failed_logins) >= 5, 'concurrent failed logins must not undercount');
  console.log('PASS  concurrent failed logins increment the lockout counter atomically');

  // ---- concurrent TOTP step ----
  const totpUser = await createUser('totp');
  const secret = generateTotpSecret();
  await pool.query(
    `UPDATE users SET totp_enabled = true, totp_secret_enc = $2, totp_last_step = 0 WHERE id = $1`,
    [totpUser.id, encryptString(secret, `totp:${totpUser.id}`)],
  );
  const code = totpCode(secret);
  const challenge = await loginPassword(totpUser.email, totpUser.password);
  assert.equal(challenge.json.twoFactorRequired, true);
  const challengeToken = challenge.json.challengeToken;
  const totpAttempts = await Promise.all([
    request('/api/auth/login/2fa', { method: 'POST', body: { challengeToken, code } }),
    request('/api/auth/login/2fa', { method: 'POST', body: { challengeToken, code } }),
  ]);
  const totpStatuses = totpAttempts.map((attempt) => attempt.status).sort((a, b) => a - b);
  assert.deepEqual(totpStatuses, [200, 401], `expected one successful TOTP login, got ${totpStatuses.join(',')}`);
  const replay = await request('/api/auth/login/2fa', { method: 'POST', body: { challengeToken, code } });
  assert.equal(replay.status, 401);
  console.log('PASS  concurrent TOTP: same time step accepted once, replay rejected');

  // ---- concurrent backup code ----
  const backupCode = '1234-5678';
  await pool.query('INSERT INTO totp_backup_codes (user_id, code_hash) VALUES ($1, $2)', [
    totpUser.id,
    sha256(backupCode.replace('-', '')),
  ]);
  const challenge2 = await loginPassword(totpUser.email, totpUser.password);
  const backupAttempts = await Promise.all([
    request('/api/auth/login/2fa', {
      method: 'POST',
      body: { challengeToken: challenge2.json.challengeToken, code: backupCode },
    }),
    request('/api/auth/login/2fa', {
      method: 'POST',
      body: { challengeToken: challenge2.json.challengeToken, code: backupCode },
    }),
  ]);
  const backupStatuses = backupAttempts.map((attempt) => attempt.status).sort((a, b) => a - b);
  assert.deepEqual(backupStatuses, [200, 401], `expected one successful backup-code login, got ${backupStatuses.join(',')}`);
  const backupReplay = await request('/api/auth/login/2fa', {
    method: 'POST',
    body: { challengeToken: challenge2.json.challengeToken, code: backupCode },
  });
  assert.equal(backupReplay.status, 401);
  console.log('PASS  concurrent backup code: consumed once, replay rejected');

  // cleanup
  await pool.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  await pool.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await pool.query('DELETE FROM login_attempts WHERE email LIKE $1', [`conc-%${stamp}%`]);
  await pool.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
  await pool.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [workspaceIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
}

main()
  .then(async () => {
    await pool.end();
    console.log('\nConcurrency checks passed');
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => {});
    process.exit(1);
  });
