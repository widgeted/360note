import type { FastifyRequest } from 'fastify';
import { one, query } from '../db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { config } from '../config.js';
import { clientIp, userAgent } from '../auth.js';

export async function createSession(
  userId: string,
  request: FastifyRequest,
  deviceId?: string | null,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
  const agent = userAgent(request);
  const ip = clientIp(request);
  // Merge legacy sessions from the same browser/IP into this device so the
  // settings page does not show the same machine once per login.
  if (deviceId) {
    await query(
      `UPDATE sessions SET device_id = $2
       WHERE user_id = $1 AND device_id IS NULL AND user_agent = $3 AND ip = $4 AND revoked_at IS NULL`,
      [userId, deviceId, agent, ip],
    ).catch(() => {});
  }
  const row = await one<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, device_id, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, sha256(token), deviceId ?? null, agent, ip, expiresAt],
  );
  return { id: row!.id, token, expiresAt };
}

export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id',
    [sessionId, userId],
  );
  return Boolean(row);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await one(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL ${exceptSessionId ? 'AND id <> $2' : ''} RETURNING id`,
    exceptSessionId ? [userId, exceptSessionId] : [userId],
  );
}

export async function revokeAllApiTokens(userId: string): Promise<void> {
  await query('UPDATE api_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

interface DeviceSessionRow {
  id: string;
  user_agent: string;
  ip: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  current: boolean;
  session_count: string | number;
}

export async function listSessions(
  userId: string,
  currentSessionId?: string,
  limit = 50,
  offset = 0,
): Promise<{
  sessions: Array<{
    id: string;
    current: boolean;
    userAgent: string;
    ip: string;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
    sessionCount: number;
  }>;
  total: number;
}> {
  const { many } = await import('../db.js');
  const totalRow = await one<{ total: string }>(
    `SELECT count(DISTINCT COALESCE(device_id, user_agent || '|' || ip))::text AS total
     FROM sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [userId],
  );
  const rows = await many<DeviceSessionRow>(
    `WITH active AS (
       SELECT *, COALESCE(device_id, user_agent || '|' || ip) AS device_key
       FROM sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     )
     SELECT
       (array_agg(id ORDER BY (id = $2) DESC, last_seen_at DESC))[1] AS id,
       (array_agg(user_agent ORDER BY last_seen_at DESC))[1] AS user_agent,
       (array_agg(ip ORDER BY last_seen_at DESC))[1] AS ip,
       min(created_at) AS created_at,
       max(last_seen_at) AS last_seen_at,
       max(expires_at) AS expires_at,
       bool_or(id = $2) AS current,
       count(*)::int AS session_count
     FROM active
     GROUP BY device_key
     ORDER BY max(last_seen_at) DESC
     LIMIT $3 OFFSET $4`,
    [userId, currentSessionId ?? null, limit, offset],
  );
  return {
    sessions: rows.map((row) => ({
      id: row.id,
      current: Boolean(row.current),
      userAgent: row.user_agent,
      ip: row.ip,
      createdAt: row.created_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      sessionCount: Number(row.session_count),
    })),
    total: Number(totalRow?.total ?? 0),
  };
}

export async function revokeDeviceSession(sessionId: string, userId: string): Promise<boolean> {
  const target = await one<{ device_key: string }>(
    `SELECT COALESCE(device_id, user_agent || '|' || ip) AS device_key
     FROM sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  if (!target) return false;
  await query(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL
       AND COALESCE(device_id, user_agent || '|' || ip) = $2
     RETURNING id`,
    [userId, target.device_key],
  );
  return true;
}

export async function revokeOtherDevices(userId: string, currentSessionId?: string): Promise<void> {
  if (!currentSessionId) {
    await revokeAllSessions(userId);
    return;
  }
  const current = await one<{ device_key: string }>(
    `SELECT COALESCE(device_id, user_agent || '|' || ip) AS device_key
     FROM sessions WHERE id = $1 AND user_id = $2`,
    [currentSessionId, userId],
  );
  if (!current) {
    await revokeAllSessions(userId);
    return;
  }
  await query(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2
       AND COALESCE(device_id, user_agent || '|' || ip) <> $3
     RETURNING id`,
    [userId, currentSessionId, current.device_key],
  );
}

export async function notify(input: {
  userId: string;
  type: string;
  title: string;
  titleEn?: string;
  body?: string | null;
  bodyEn?: string | null;
  link?: string | null;
}): Promise<void> {
  let title = input.title;
  let body = input.body ?? null;
  if (input.titleEn) {
    const recipient = await one<{ prefs: Record<string, unknown> | null }>('SELECT prefs FROM users WHERE id = $1', [input.userId]);
    if (String(recipient?.prefs?.locale ?? '').toLowerCase().startsWith('en')) {
      title = input.titleEn;
      body = input.bodyEn ?? body;
    }
  }
  await one(
    `INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.userId, input.type, title, body, input.link ?? null],
  );
}
