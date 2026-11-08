import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';

const KNOWN_HOSTS = new Set([
  '360note.com',
  'www.360note.com',
  '360biji.com',
  'www.360biji.com',
]);

/**
 * Keep generated links on the domain the user is actually using. The two
 * domains share one database, but a share/invite created on 360biji.com should
 * stay on 360biji.com so it opens in Chinese.
 */
export function originFromRequest(request: FastifyRequest): string {
  const rawHost = request.headers['x-forwarded-host'] ?? request.headers.host;
  const host = Array.isArray(rawHost) ? rawHost[0] : rawHost;
  const clean = (host ?? '').split(',')[0].trim().toLowerCase();
  if (KNOWN_HOSTS.has(clean)) {
    const protoHeader = request.headers['x-forwarded-proto'];
    const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader)?.split(',')[0].trim();
    return `${proto === 'http' ? 'http' : 'https'}://${clean}`;
  }
  return config.publicOrigin;
}
