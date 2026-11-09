#!/usr/bin/env node
/**
 * Job durability tests: atomic claim, single execution, and restart recovery.
 * Uses a throwaway database. Requires the server to be built.
 *
 *   sudo bash -c 'set -a; source /etc/360note/360note.env; set +a;
 *     /opt/node22/bin/node tests/integration/jobs-recovery.mjs'
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) throw new Error('DATABASE_URL is required');
const stamp = Date.now();
const database = `note360_jobs_${stamp}`;
const dataDir = `/tmp/opencode/jobs-data-${stamp}`;
const dbUrl = new URL(baseDatabaseUrl);
dbUrl.pathname = `/${database}`;

process.env.DATABASE_URL = dbUrl.toString();
process.env.NODE_ENV = 'test';
process.env.NOTE360_DATA_DIR = dataDir;
process.env.NOTE360_ENV_FILE = '/tmp/opencode/nonexistent.env';

const { migrate } = await import('../../apps/server/dist/migrate.js');
const { one, query, closePool } = await import('../../apps/server/dist/db.js');
const { createJob, claimJob, recoverInterruptedJobs, getJob, runJob } = await import('../../apps/server/dist/lib/jobs.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let created = false;

try {
  execFileSync('sudo', ['-u', 'postgres', 'createdb', '-O', 'note360', database]);
  created = true;
  await migrate();

  const user = await one(
    `INSERT INTO users (email, display_name, password_hash, prefs)
     VALUES ($1, 'Job tester', 'not-a-real-hash', '{}'::jsonb) RETURNING id`,
    [`jobs-${stamp}@invalid.local`],
  );
  assert.ok(user?.id);

  // 1. A queued job can be claimed exactly once.
  const first = await createJob('test-claim', { run: 1 }, user.id);
  assert.equal(await claimJob(first), true);
  assert.equal(await claimJob(first), false);
  assert.equal((await getJob(first))?.status, 'running');
  console.log('PASS  atomic job claim allows exactly one owner');

  // 2. Two concurrent runJob calls execute the task once.
  let executions = 0;
  const guarded = await createJob('test-double-run', { run: 2 }, user.id);
  for (let index = 0; index < 2; index += 1) {
    runJob(guarded, async () => {
      executions += 1;
      await sleep(80);
      return { executed: true };
    });
  }
  for (let index = 0; index < 40; index += 1) {
    if ((await getJob(guarded))?.status === 'done') break;
    await sleep(50);
  }
  assert.equal(executions, 1, 'task must not execute twice');
  assert.equal((await getJob(guarded))?.status, 'done');
  console.log('PASS  duplicate runJob dispatch runs the task once');

  // 3. Startup recovery fails queued/running jobs and leaves finished jobs alone.
  const queued = await createJob('test-queued', {}, user.id);
  const running = await createJob('test-running', {}, user.id);
  await query(`UPDATE jobs SET status = 'running' WHERE id = $1`, [running]);
  const done = await createJob('test-done', {}, user.id);
  await query(`UPDATE jobs SET status = 'done', progress = 100 WHERE id = $1`, [done]);

  const recovered = await recoverInterruptedJobs();
  assert.equal(recovered, 3, 'includes the claimed job left running by the previous process');
  const statuses = await query(
    'SELECT id, status FROM jobs WHERE id = ANY($1::uuid[])',
    [[first, guarded, queued, running, done]],
  );
  const byId = Object.fromEntries(statuses.rows.map((row) => [row.id, row.status]));
  assert.equal(byId[queued], 'error');
  assert.equal(byId[running], 'error');
  assert.equal(byId[done], 'done');
  assert.equal(byId[first], 'error');
  assert.equal(byId[guarded], 'done');
  console.log('PASS  recovery fails interrupted jobs and preserves completed ones');
} finally {
  await closePool().catch(() => {});
  if (created) {
    try {
      execFileSync('sudo', ['-u', 'postgres', 'dropdb', '--if-exists', database]);
    } catch (error) {
      console.error('failed to drop test database', error.message);
    }
  }
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
}
