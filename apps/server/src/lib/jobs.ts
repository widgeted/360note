import { many, one } from '../db.js';
import { randomId } from './crypto.js';

export interface JobRow {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  message: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createJob(type: string, payload: Record<string, unknown>, userId: string): Promise<string> {
  const id = randomId();
  await one(
    `INSERT INTO jobs (id, type, status, payload, created_by) VALUES ($1, $2, 'queued', $3, $4) RETURNING id`,
    [id, type, JSON.stringify(payload), userId],
  );
  return id;
}

export async function getJob(id: string): Promise<JobRow | null> {
  return one<JobRow>('SELECT * FROM jobs WHERE id = $1', [id]);
}

export async function updateJob(
  id: string,
  updates: { status?: string; progress?: number; message?: string | null; result?: Record<string, unknown> | null; error?: string | null },
): Promise<void> {
  await one(
    `UPDATE jobs SET
       status = COALESCE($2, status),
       progress = COALESCE($3, progress),
       message = CASE WHEN $4 THEN $5 ELSE message END,
       result = CASE WHEN $6 THEN $7 ELSE result END,
       error = CASE WHEN $8 THEN $9 ELSE error END,
       updated_at = now()
     WHERE id = $1 RETURNING id`,
    [
      id,
      updates.status ?? null,
      updates.progress ?? null,
      updates.message !== undefined,
      updates.message ?? null,
      updates.result !== undefined,
      updates.result ? JSON.stringify(updates.result) : null,
      updates.error !== undefined,
      updates.error ?? null,
    ],
  );
}

/**
 * Atomically take ownership of a queued job. Returns false when another worker
 * (or a previous run) already claimed or completed it, so a task never runs twice.
 */
export async function claimJob(jobId: string): Promise<boolean> {
  const row = await one(
    `UPDATE jobs
       SET status = 'running', progress = GREATEST(progress, 1), message = '正在处理…', updated_at = now()
     WHERE id = $1 AND status = 'queued'
     RETURNING id`,
    [jobId],
  );
  return Boolean(row);
}

/**
 * On startup, every queued/running job belongs to a process that no longer
 * exists: callbacks cannot be restored after a restart. Mark them failed with a
 * clear retry hint instead of leaving jobs at "running" forever.
 */
export async function recoverInterruptedJobs(): Promise<number> {
  const rows = await many(
    `UPDATE jobs
       SET status = 'error',
           progress = 100,
           message = NULL,
           error = COALESCE(NULLIF(error, ''), '服务重启导致任务中断，请重新执行'),
           updated_at = now()
     WHERE status IN ('queued', 'running')
     RETURNING id`,
  );
  return rows.length;
}

/** Run an async job without blocking the request; failures are serialized into the jobs table. */
export function runJob(jobId: string, task: () => Promise<Record<string, unknown>>): void {
  void (async () => {
    let claimed = false;
    try {
      claimed = await claimJob(jobId);
    } catch (error) {
      console.error('[job] claim failed', jobId, error);
      return;
    }
    if (!claimed) return;
    try {
      const result = await task();
      await updateJob(jobId, { status: 'done', progress: 100, message: null, result });
    } catch (error) {
      console.error('[job] failed', jobId, error);
      await updateJob(jobId, {
        status: 'error',
        progress: 100,
        error: (error as Error).message || '任务失败',
      }).catch(() => {});
    }
  })();
}

export async function listRecentJobs(userId: string, limit = 20): Promise<JobRow[]> {
  return many<JobRow>('SELECT * FROM jobs WHERE created_by = $1 ORDER BY created_at DESC LIMIT $2', [userId, limit]);
}
