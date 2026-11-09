#!/usr/bin/env node
/**
 * PostgreSQL/API integration test against a throwaway database and API process.
 * Covers registration, workspace isolation, notes and a real backup round-trip.
 *
 * Run as root with production env loaded:
 *   sudo bash -c 'set -a; source /etc/360note/360note.env; set +a;
 *     /opt/node22/bin/node tests/integration/postgres-api.mjs'
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import pg from 'pg';
import assert from 'node:assert/strict';
import { sha256 } from '../../apps/server/dist/lib/crypto.js';

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) throw new Error('DATABASE_URL is required');
const stamp = Date.now();
const database = `note360_integration_${stamp}`;
const port = 8898;
const dataDir = `/tmp/opencode/integration-data-${stamp}`;
const dbUrl = new URL(baseDatabaseUrl);
dbUrl.pathname = `/${database}`;
const base = `http://127.0.0.1:${port}`;
let child = null;
let pool = null;

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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('API did not become healthy');
}

async function req(path, { method = 'GET', cookie, body } = {}) {
  const headers = { 'x-360note-csrf': '1', 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 20}` };
  if (cookie) headers.cookie = cookie;
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
    /* ignore */
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function register(email, code) {
  await pool.query(
    `INSERT INTO email_codes (email, purpose, code_hash, expires_at)
     VALUES ($1, 'register', $2, now() + interval '10 minutes')`,
    [email, sha256(`register:${email}:${code}`)],
  );
  const response = await req('/api/auth/register', {
    method: 'POST',
    body: { email, displayName: email.split('@')[0], password: 'K9m!tR4#vQ2@2026', emailCode: code },
  });
  assert.equal(response.status, 200, response.text);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { ...response.json, cookie };
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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  pool = new pg.Pool({ connectionString: dbUrl.toString(), max: 5 });

  const emailA = `int-a-${stamp}@invalid.local`;
  const emailB = `int-b-${stamp}@invalid.local`;
  const a = await register(emailA, '111111');
  const b = await register(emailB, '222222');
  assert.equal(a.firstUser, true);
  assert.equal(b.firstUser, false);

  const spaceA = a.workspaces.find((workspace) => workspace.kind === 'personal');
  const seeded = await req(`/api/notes?workspaceId=${spaceA.id}`, { cookie: a.cookie });
  assert.equal(seeded.status, 200, seeded.text);
  assert.equal(seeded.json.notes.length, 1, 'new accounts get exactly one welcome note');
  assert.match(seeded.json.notes[0].title, /欢迎|Welcome/);
  const seededNote = await req(`/api/notes/${seeded.json.notes[0].id}`, { cookie: a.cookie });
  assert.match(seededNote.json.note.contentMd, /Markdown/, 'welcome note includes the Markdown reference');
  assert.doesNotMatch(seededNote.json.note.contentMd, /关于 360note 的设计|About the design/, 'design note content must be gone');
  const note = await req('/api/notes', {
    method: 'POST',
    cookie: a.cookie,
    body: { workspaceId: spaceA.id, title: 'Integration note', contentMd: '# Integration\n\nbody', tagNames: ['integration'] },
  });
  assert.equal(note.status, 200, note.text);
  const noteId = note.json.note.id;

  const crossRead = await req(`/api/notes/${noteId}`, { cookie: b.cookie });
  assert.ok([403, 404].includes(crossRead.status), `cross-workspace read returned ${crossRead.status}`);

  const backupStart = await req(`/api/workspaces/${spaceA.id}/backups`, { method: 'POST', cookie: a.cookie });
  assert.equal(backupStart.status, 200, backupStart.text);
  let job;
  for (let index = 0; index < 80; index += 1) {
    job = await req(`/api/jobs/${backupStart.json.jobId}`, { cookie: a.cookie });
    if (job.json?.job?.status === 'done' || job.json?.job?.status === 'error') break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(job.json?.job?.status, 'done', JSON.stringify(job.json));
  const backups = await req(`/api/workspaces/${spaceA.id}/backups`, { cookie: a.cookie });
  assert.equal(backups.status, 200);
  assert.ok(backups.json.backups.length >= 1);
  const backup = backups.json.backups[0];
  const preview = await req(`/api/backups/${backup.id}/preview?workspaceId=${spaceA.id}`, { cookie: a.cookie });
  assert.equal(preview.status, 200, preview.text);
  assert.ok(preview.json.preview.counts.notes >= 1);

  // Invitation identity: a known invitee stays bound by user id after an email
  // change, while a different account that later owns the old address cannot
  // see or accept the invitation.
  const team = await req('/api/workspaces', {
    method: 'POST',
    cookie: a.cookie,
    body: { name: 'Integration team', kind: 'team' },
  });
  assert.equal(team.status, 200, team.text);
  const teamId = team.json.workspace.id;

  const invite = await req(`/api/workspaces/${teamId}/invitations`, {
    method: 'POST',
    cookie: a.cookie,
    body: { email: emailB, role: 'editor' },
  });
  assert.equal(invite.status, 200, invite.text);

  const newEmailB = `int-b-moved-${stamp}@invalid.local`;
  await pool.query('UPDATE users SET email = $2 WHERE lower(email) = lower($1)', [emailB, newEmailB]);
  const listedForB = await req('/api/invitations', { cookie: b.cookie });
  assert.equal(listedForB.status, 200, listedForB.text);
  const pendingForB = listedForB.json.invitations.find((entry) => entry.workspaceId === teamId);
  assert.ok(pendingForB?.token, 'invitation must remain visible after the invitee changes email');

  const c = await register(emailB, '444444');
  const listedForC = await req('/api/invitations', { cookie: c.cookie });
  assert.ok(!listedForC.json.invitations.some((entry) => entry.workspaceId === teamId), 'old address must not inherit the invitation');
  const stolen = await req(`/api/invitations/${pendingForB.token}/accept`, { method: 'POST', cookie: c.cookie });
  assert.equal(stolen.status, 403, stolen.text);

  const accepted = await req(`/api/invitations/${pendingForB.token}/accept`, { method: 'POST', cookie: b.cookie });
  assert.equal(accepted.status, 200, accepted.text);
  assert.equal(accepted.json.workspaceId, teamId);
  console.log('PASS  invitations bind to the invitee identity across email changes');

  // Two parallel invitations to the same address yield exactly one pending row.
  const raceEmail = `int-race-${stamp}@invalid.local`;
  const race = await Promise.all([
    req(`/api/workspaces/${teamId}/invitations`, { method: 'POST', cookie: a.cookie, body: { email: raceEmail, role: 'viewer' } }),
    req(`/api/workspaces/${teamId}/invitations`, { method: 'POST', cookie: a.cookie, body: { email: raceEmail, role: 'viewer' } }),
  ]);
  const statuses = race.map((entry) => entry.status).sort();
  assert.deepEqual(statuses, [200, 409], JSON.stringify(race.map((entry) => entry.text)));
  const pendingRows = await pool.query(
    `SELECT count(*)::int AS count FROM workspace_invitations
     WHERE workspace_id = $1 AND lower(email) = lower($2) AND status = 'pending'`,
    [teamId, raceEmail],
  );
  assert.equal(pendingRows.rows[0].count, 1);
  console.log('PASS  concurrent duplicate invitations leave exactly one pending row');

  console.log('PASS  register/login, workspace isolation, notes and backup round-trip');
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
      console.error('failed to drop integration database', error.message);
    }
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });
