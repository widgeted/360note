import { pool } from '../db.js';

/**
 * Serialize destructive workspace operations (restore/import) across requests
 * and processes. The lock is held on a dedicated connection for the whole
 * operation and released in finally.
 */
export async function withWorkspaceLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const key = `workspace-operation:${workspaceId}`;
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {});
    client.release();
  }
}
