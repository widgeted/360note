import { one } from '../db.js';

/**
 * Keep operational tables bounded. User content is deliberately excluded;
 * audit retention is one year and sessions/login attempts are short-lived.
 */
export async function cleanupOperationalData(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const counts = await Promise.all([
    one<{ count: string }>(`WITH deleted AS (DELETE FROM login_attempts WHERE created_at < now() - interval '90 days' RETURNING 1) SELECT count(*)::text AS count FROM deleted`),
    one<{ count: string }>(`WITH deleted AS (DELETE FROM sessions WHERE coalesce(revoked_at, expires_at) < now() - interval '30 days' RETURNING 1) SELECT count(*)::text AS count FROM deleted`),
    one<{ count: string }>(`WITH deleted AS (DELETE FROM jobs WHERE created_at < now() - interval '30 days' AND status IN ('done','error') RETURNING 1) SELECT count(*)::text AS count FROM deleted`),
    one<{ count: string }>(`WITH deleted AS (DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < now() - interval '180 days' RETURNING 1) SELECT count(*)::text AS count FROM deleted`),
    one<{ count: string }>(`WITH deleted AS (DELETE FROM audit_logs WHERE created_at < now() - interval '365 days' RETURNING 1) SELECT count(*)::text AS count FROM deleted`),
    one<{ count: string }>(`WITH deleted AS (DELETE FROM email_codes WHERE created_at < now() - interval '24 hours' RETURNING 1) SELECT count(*)::text AS count FROM deleted`),
  ]);
  ['loginAttempts', 'sessions', 'jobs', 'notifications', 'auditLogs', 'emailCodes'].forEach((key, index) => {
    result[key] = Number(counts[index]?.count ?? 0);
  });
  return result;
}
