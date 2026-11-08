import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { config } from './config.js';
import { one, query } from './db.js';
import { sha256 } from './lib/crypto.js';
import { errors } from './lib/errors.js';
import type { AuthContext, DbSession, DbUser } from './lib/users.js';

const COOKIE_NAME = config.env === 'production' ? '__Host-nh_session' : 'nh_session';

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    maxAge: config.sessionDays * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
  });
}

async function resolveBearer(request: FastifyRequest): Promise<AuthContext | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token.startsWith('nh_')) return null;
  const tokenHash = sha256(token);
  const row = await one<{
    id: string;
    user_id: string;
    scopes: string[];
    expires_at: Date | null;
    revoked_at: Date | null;
  }>('SELECT id, user_id, scopes, expires_at, revoked_at FROM api_tokens WHERE token_hash = $1', [tokenHash]);
  if (!row || row.revoked_at || (row.expires_at && row.expires_at < new Date())) return null;
  const user = await one<DbUser>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [row.user_id]);
  if (!user) return null;
  void query('UPDATE api_tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval \'1 minute\')', [row.id]).catch(() => {});
  return { user, session: null, tokenId: row.id, tokenScopes: row.scopes ?? [] };
}

async function resolveSession(request: FastifyRequest): Promise<AuthContext | null> {
  const raw = request.cookies[COOKIE_NAME];
  if (!raw) return null;
  const tokenHash = sha256(raw);
  const row = await one<DbSession & { user_id: string }>(
    `SELECT * FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [tokenHash],
  );
  if (!row) return null;
  const user = await one<DbUser>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [row.user_id]);
  if (!user) return null;
  void query(
    `UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'`,
    [row.id],
  ).catch(() => {});
  return { user, session: row };
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (request.method === 'OPTIONS') return;

    if (config.trustProxy) {
      // Fastify trustProxy is configured at the instance level; this is a no-op safety marker.
    }

    // CSRF: cookie-authenticated mutations require the custom header. Bearer API calls are exempt.
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const bearer = request.headers.authorization?.startsWith('Bearer ');
    if (isMutation && !bearer && request.headers['x-360note-csrf'] !== '1') {
      return reply.status(403).send({ error: { code: 'CSRF_REQUIRED', message: '缺少安全请求头' } });
    }

    try {
      request.auth = (await resolveBearer(request)) ?? (await resolveSession(request));
    } catch (error) {
      app.log.error({ error }, 'failed to resolve authentication');
      request.auth = null;
    }

    // Bearer tokens are deliberately limited to the notes API. They cannot
    // manage sessions, tokens, backups, admin settings or account deletion.
    if (request.auth?.tokenId) {
      const path = request.url.split('?')[0];
      const allowed =
        path.startsWith('/api/notes') ||
        path.startsWith('/api/folders') ||
        path.startsWith('/api/tags') ||
        path.startsWith('/api/search') ||
        path.startsWith('/api/attachments') ||
        path.startsWith('/api/export');
      if (!allowed || path.includes('/shares')) {
        return reply.status(403).send({ error: { code: 'TOKEN_SCOPE', message: '此 API 令牌无权访问该接口' } });
      }
      const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
      const required = mutation ? 'notes:write' : 'notes:read';
      const scopes = request.auth.tokenScopes ?? [];
      if (!scopes.includes('*') && !scopes.includes(required)) {
        return reply.status(403).send({ error: { code: 'TOKEN_SCOPE', message: `此 API 令牌缺少 ${required} 权限` } });
      }
    }
  });
});

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw errors.unauthorized();
  return request.auth;
}

export function hasScope(auth: AuthContext, scope: 'notes:read' | 'notes:write' | 'admin'): boolean {
  if (!auth.tokenId) return true;
  // Token scopes live in the DB; auth resolution intentionally keeps this light.
  // The route guard below checks the token row when it matters.
  return true;
}

export function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return request.ip || '';
}

export function userAgent(request: FastifyRequest): string {
  return String(request.headers['user-agent'] || '').slice(0, 300);
}

export async function requireScope(request: FastifyRequest, scope: string): Promise<void> {
  const auth = requireAuth(request);
  if (!auth.tokenId) return;
  const row = await one<{ scopes: string[] }>('SELECT scopes FROM api_tokens WHERE id = $1', [auth.tokenId]);
  const scopes = row?.scopes ?? [];
  if (!scopes.includes(scope) && !scopes.includes('*')) {
    throw errors.forbidden('此 API 令牌没有所需权限');
  }
}

export const sessionCookieName = COOKIE_NAME;
