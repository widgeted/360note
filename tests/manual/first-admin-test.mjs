#!/usr/bin/env node
/**
 * Concurrent first-registration test on a throwaway database/API instance.
 *
 * It creates a temporary database, starts the built API on port 8899 with mail
 * disabled, inserts two registration codes directly, fires both registrations
 * at the same time, and asserts exactly one instance administrator.
 *
 * Run as root with the production env loaded:
 *   sudo bash -c 'set -a; source /etc/360note/360note.env; set +a; \
 *     DATABASE_URL=... /opt/node22/bin/node tests/manual/first-admin-test.mjs'
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import pg from 'pg';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { sha256 } from '../../apps/server/dist/lib/crypto.js';

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) throw new Error('DATABASE_URL is required');
const stamp = Date.now();
const database = `note360_first_admin_${stamp}`;
const port = 8899;
const dataDir = `/tmp/opencode/first-admin-data-${stamp}`;
const base = new URL(baseDatabaseUrl);
const dbUrl = new URL(baseDatabaseUrl);
dbUrl.pathname = `/${database}`;

let child = null;
let pool = null;

async function waitForHealth(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`temporary API exited with ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('temporary API did not become healthy');
}

async function main() {
  execFileSync('sudo', ['-u', 'postgres', 'createdb', '-O', 'note360', database]);
  const env = {
    ...process.env,
    DATABASE_URL: dbUrl.toString(),
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    NOTE360_DATA_DIR: dataDir,
    WEB_DIST: '/opt/360note/apps/web/dist',
    NOTE360_ENV_FILE: '/tmp/opencode/nonexistent.env',
    SMTP_HOST: '',
    REGISTRATION_MODE: 'open',
  };
  child = spawn('/opt/node22/bin/node', ['apps/server/dist/index.js'], {
    cwd: '/opt/360note',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  await waitForHealth();

  pool = new pg.Pool({ connectionString: dbUrl.toString(), max: 4 });
  const emails = [`first-a-${stamp}@invalid.local`, `first-b-${stamp}@invalid.local`];
  const codes = ['111111', '222222'];
  for (let index = 0; index < emails.length; index += 1) {
    await pool.query(
      `INSERT INTO email_codes (email, purpose, code_hash, expires_at)
       VALUES ($1, 'register', $2, now() + interval '10 minutes')`,
      [emails[index], sha256(`register:${emails[index]}:${codes[index]}`)],
    );
  }

  const password = 'K9m!tR4#vQ2@2026';
  const register = (index) =>
    fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-360note-csrf': '1' },
      body: JSON.stringify({
        email: emails[index],
        displayName: `First admin ${index}`,
        password,
        emailCode: codes[index],
      }),
    });

  const responses = await Promise.all([register(0), register(1)]);
  const bodies = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() })));
  assert.deepEqual(bodies.map((entry) => entry.status).sort((a, b) => a - b), [200, 200], JSON.stringify(bodies));
  const firstFlags = bodies.map((entry) => Boolean(entry.body.firstUser)).sort();
  assert.deepEqual(firstFlags, [false, true], `expected exactly one firstUser, got ${firstFlags}`);

  const roles = await pool.query(`SELECT role, count(*)::int AS count FROM users WHERE deleted_at IS NULL GROUP BY role ORDER BY role`);
  const byRole = Object.fromEntries(roles.rows.map((row) => [row.role, row.count]));
  assert.equal(byRole.admin, 1, `expected exactly one admin, got ${JSON.stringify(byRole)}`);
  assert.equal(byRole.user, 1, `expected exactly one normal user, got ${JSON.stringify(byRole)}`);
  console.log('PASS  concurrent first registration creates exactly one administrator');
}

main()
  .catch((error) => {
    console.error(error);
    if (child) console.error(child.spawnargs?.join(' '));
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
      console.error('failed to drop temporary database', error.message);
    }
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });
