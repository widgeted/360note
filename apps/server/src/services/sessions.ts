import type { FastifyRequest } from 'fastify';
import { one } from '../db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { config } from '../config.js';
import type { DbSession } from '../lib/users.js';
import { clientIp, userAgent } from '../auth.js';

export async function createSession(userId: string, request: FastifyRequest): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
  const row = await one<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, sha256(token), userAgent(request), clientIp(request), expiresAt],
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

export async function listSessions(userId: string, currentSessionId?: string) {
  const { many } = await import('../db.js');
  const rows = await many<DbSession>(
    `SELECT * FROM sessions WHERE user_id = $1 ORDER BY revoked_at IS NULL DESC, last_seen_at DESC LIMIT 50`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    current: row.id === currentSessionId,
    userAgent: row.user_agent,
    ip: row.ip,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  }));
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
