import Fastify, { type FastifyReply } from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config, ensureDataDirs } from './config.js';
import { migrate } from './migrate.js';
import { validateCryptoConfig } from './lib/crypto.js';
import { closePool, one } from './db.js';
import { AppError, errorPayload } from './lib/errors.js';
import { localizeMessage, requestLanguage } from './lib/i18n.js';
import authPlugin from './auth.js';
import authRoutes from './routes/auth.js';
import workspaceRoutes from './routes/workspaces.js';
import noteRoutes from './routes/notes.js';
import folderRoutes from './routes/folders.js';
import tagRoutes from './routes/tags.js';
import attachmentRoutes from './routes/attachments.js';
import commentRoutes from './routes/comments.js';
import shareRoutes from './routes/shares.js';
import exportRoutes from './routes/export.js';
import importRoutes from './routes/import.js';
import backupRoutes from './routes/backups.js';
import adminRoutes from './routes/admin.js';
import accountRoutes from './routes/account.js';
import templateRoutes from './routes/templates.js';
import { resumePendingOcr } from './lib/ocr.js';
import { getSiteHeadCode } from './services/site.js';
import { pdfExportAvailable } from './services/export.js';
import { recoverInterruptedJobs } from './lib/jobs.js';
import { cleanupImportUploads, runAutoBackups } from './services/backups.js';
import { purgeExpiredTrash } from './services/notes.js';
import { cleanupOperationalData } from './services/maintenance.js';
import { runInstanceAutoBackup, runScheduledRestoreDrill } from './services/instance-backups.js';

const PUBLIC_HEAD_PATHS = new Set([
  '/',
  '/index.html',
  '/about',
  '/about.html',
  '/privacy',
  '/terms',
]);

function shouldInjectHead(url: string): boolean {
  const pathname = (url.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  return PUBLIC_HEAD_PATHS.has(pathname);
}

let shellHtml: string | null = null;

function readShellHtml(): string | null {
  if (shellHtml !== null) return shellHtml;
  try {
    shellHtml = fs.readFileSync(`${config.webDist}/index.html`, 'utf8');
  } catch {
    shellHtml = null;
  }
  return shellHtml;
}

function buildDocumentCsp(headCode: string): string {
  const hashes = new Set<string>();
  const origins = new Set<string>();
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of headCode.matchAll(scriptPattern)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (srcMatch) {
      const raw = (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '').trim();
      if (raw) {
        try {
          const resolved = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
          if (resolved.protocol === 'https:' || resolved.protocol === 'http:') origins.add(resolved.origin);
        } catch {
          // Malformed src is left for the browser to reject; it must not widen CSP.
        }
      }
      continue;
    }
    if (body.trim()) {
      hashes.add(`'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`);
    }
  }
  // Analytics snippets usually create their loader with a URL string inside an
  // inline script, so allowlist every absolute origin mentioned in the code.
  for (const match of headCode.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)) {
    try {
      const resolved = new URL(match[0]);
      origins.add(resolved.origin);
    } catch {
      // Ignore partial URLs.
    }
  }
  const scriptSrc = ["'self'", 'https://static.cloudflareinsights.com', ...hashes, ...origins].join(' ');
  const connectSrc = ["'self'", 'https://cloudflareinsights.com', 'https://static.cloudflareinsights.com', ...origins].join(' ');
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function localizeShell(html: string, url: string, hostValue: string | undefined): string {
  const host = (hostValue ?? '').split(',')[0].trim().toLowerCase();
  const chinese = host.endsWith('360biji.com') || host === 'localhost' || host === '127.0.0.1';
  const locale = chinese ? 'zh-CN' : 'en';
  const title = chinese ? '360笔记 — 把想法留下，把知识连起来' : '360note — Keep ideas, connect knowledge';
  const description = chinese
    ? '360笔记：一个安静、快速、本地优先的笔记空间。记录想法，建立联系，发布作品。'
    : '360note: a calm, fast, local-first notebook for ideas, knowledge and publishing.';
  const origin = chinese ? 'https://360biji.com' : 'https://360note.com';
  const path = url.split('?')[0].split('#')[0] || '/';
  const canonical = `${origin}${path === '/' ? '/' : path.replace(/\/+$/, '')}`;
  const manifest = chinese ? '/manifest-zh.webmanifest' : '/manifest-en.webmanifest';
  let output = html
    .replace(/<html lang="[^"]*"/i, `<html lang="${locale}"`)
    .replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/i, `$1${escapeHtml(description)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/i, `$1${escapeHtml(title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/i, `$1${escapeHtml(description)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/i, `$1${escapeHtml(canonical)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/i, `$1${escapeHtml(title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/i, `$1${escapeHtml(description)}$2`)
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/i, `$1${chinese ? '360笔记' : '360note'}$2`)
    .replace('</head>', `  <link rel="canonical" data-nh-seo="true" href="${escapeHtml(canonical)}" />\n  <link rel="alternate" data-nh-seo="true" hreflang="zh-CN" href="https://360biji.com${path}" />\n  <link rel="alternate" data-nh-seo="true" hreflang="en" href="https://360note.com${path}" />\n  <link rel="alternate" data-nh-seo="true" hreflang="x-default" href="https://360note.com${path}" />\n  <link rel="manifest" href="${manifest}" />\n  </head>`);
  return output.replace('<link rel="manifest" href="/manifest.webmanifest">', '');
}

async function sendAppShell(reply: FastifyReply, url: string, host?: string) {
  const html = readShellHtml();
  if (!html) return reply.status(503).send('360note web build not found');
  const localized = localizeShell(html, url, host);
  const injected = shouldInjectHead(url) ? (await getSiteHeadCode()).trim() : '';
  const body = injected ? localized.replace('</head>', `${injected}\n  </head>`) : localized;
  const response = reply
    .header('Cache-Control', 'no-cache, no-store, must-revalidate')
    .header('Content-Security-Policy', buildDocumentCsp(injected));
  // Share pages are capabilities, not public marketing pages. Keep them out
  // of search indexes on both domains even when Nginx serves the shell.
  if (url.split('?')[0].startsWith('/s/')) response.header('X-Robots-Tag', 'noindex');
  return response.type('text/html; charset=utf-8').send(body);
}

async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.env === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'body.password', 'body.currentPassword', 'body.newPassword'],
    },
    trustProxy: config.trustProxy,
    bodyLimit: 10 * 1024 * 1024,
    maxParamLength: 2048,
    disableRequestLogging: config.env === 'production',
  });

  await app.register(helmet, {
    // HTML responses set their own CSP (including admin-provided verification
    // and analytics code). Keep the remaining helmet protections.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    xFrameOptions: { action: 'deny' },
    hsts: config.env === 'production' ? { maxAge: 15552000, includeSubDomains: true, preload: false } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    return payload;
  });

  await app.register(cookie);
  await app.register(compress, { global: true, encodings: ['gzip', 'deflate', 'br'] });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    allowList: (request) => !request.url.startsWith('/api/'),
    keyGenerator: (request) => request.ip,
  });
  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 20, fields: 20 },
  });
  await app.register(authPlugin);

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    const language = requestLanguage(request.headers as Record<string, unknown>);
    const localize = (message: string) => localizeMessage(message, language);
    if (error instanceof AppError) {
      if (error.statusCode >= 500) app.log.error({ error, stack: error.stack, url: request.url }, 'request failed');
      const payload = errorPayload(error);
      payload.error.message = localize(payload.error.message);
      return reply.status(error.statusCode).send(payload);
    }
    if (error.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'TOO_MANY_REQUESTS', message: localize('请求过于频繁，请稍后再试') } });
    }
    if (error.statusCode === 413) {
      return reply.status(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: localize('上传内容过大') } });
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        error: { code: error.code || 'BAD_REQUEST', message: localize('请求无效') },
      });
    }
    app.log.error({ error, stack: error.stack, url: request.url }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: localize('服务器内部错误') } });
  });


  app.get('/api/public/config', async () => ({
    version: config.version,
    registrationMode: config.registrationMode,
    aiEnabled: config.ai.enabled,
    ocrEnabled: config.ocrEnabled,
    pdfExportEnabled: pdfExportAvailable(),
    maxUploadBytes: config.maxUploadBytes,
    publicOrigin: config.publicOrigin,
    brand: '360note',
    mailEnabled: Boolean(config.mail.host && config.mail.user && config.mail.pass),
  }));

  app.get('/health', async (request, reply) => {
    let database = false;
    try {
      await one('SELECT 1 AS ok');
      database = true;
    } catch {
      database = false;
    }
    if (!database) reply.status(503);
    return { ok: database, version: config.version, time: new Date().toISOString(), database };
  });

  await app.register(authRoutes);
  await app.register(workspaceRoutes);
  await app.register(noteRoutes);
  await app.register(folderRoutes);
  await app.register(tagRoutes);
  await app.register(attachmentRoutes);
  await app.register(commentRoutes);
  await app.register(shareRoutes);
  await app.register(exportRoutes);
  await app.register(importRoutes);
  await app.register(backupRoutes);
  await app.register(adminRoutes);
  await app.register(accountRoutes);
  await app.register(templateRoutes);

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.status(404).send('Not found');
    }
    // Never serve the SPA shell for missing assets; it hides deployment mistakes as MIME errors.
    if (request.url.startsWith('/assets/') || /\.(?:js|css|woff2?|png|jpe?g|svg|ico|webmanifest|map)$/i.test(request.url)) {
      return reply.status(404).send('Not found');
    }
    return sendAppShell(reply, request.url, (request.headers['x-forwarded-host'] as string | undefined) ?? request.headers.host);
  });

  app.get('/index.html', async (request, reply) => sendAppShell(reply, request.url, (request.headers['x-forwarded-host'] as string | undefined) ?? request.headers.host));

  if (fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: '/',
      wildcard: false,
      index: false,
      globIgnore: ['index.html'],
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) {
          res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (filePath.includes('/assets/') || filePath.includes('/icons/') || filePath.includes('/fonts/')) {
          res.header('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.header('Cache-Control', 'public, max-age=3600');
        }
      },
    });
  }

  return app;
}

async function start() {
  validateCryptoConfig();
  ensureDataDirs();
  await migrate();
  const recovered = await recoverInterruptedJobs().catch((error) => {
    console.error('[job] recovery failed', error);
    return 0;
  });
  if (recovered > 0) console.warn(`[job] marked ${recovered} interrupted job(s) as failed`);
  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`360note API listening on http://${config.host}:${config.port}`);
  void resumePendingOcr(app.log).catch((error) => app.log.error({ error }, 'OCR resume failed'));
  void cleanupImportUploads();

  // Daily backup around 03:00 local server time, plus a check every six hours.
  const scheduleBackup = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 15, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = Math.min(next.getTime() - now.getTime(), 6 * 60 * 60 * 1000);
    setTimeout(async () => {
      try {
        await runAutoBackups();
        await runInstanceAutoBackup();
        await runScheduledRestoreDrill();
      } catch (error) {
        app.log.error({ error }, 'auto backup run failed');
      } finally {
        scheduleBackup();
      }
    }, Math.max(delay, 60_000)).unref();
  };
  scheduleBackup();
  setInterval(() => {
    void cleanupImportUploads();
  }, 6 * 60 * 60 * 1000).unref();
  const purgeTrash = () => {
    void purgeExpiredTrash()
      .then((result) => {
        if (result.notes || result.folders || result.attachments) {
          app.log.info(result, 'expired trash purged');
        }
      })
      .catch((error) => app.log.error({ error }, 'trash purge failed'));
  };
  purgeTrash();
  setInterval(purgeTrash, 6 * 60 * 60 * 1000).unref();
  const cleanupOperational = () => {
    void cleanupOperationalData()
      .then((result) => app.log.info(result, 'operational data cleaned'))
      .catch((error) => app.log.error({ error }, 'operational cleanup failed'));
  };
  cleanupOperational();
  setInterval(cleanupOperational, 24 * 60 * 60 * 1000).unref();
  setInterval(() => {
    void runScheduledRestoreDrill().catch((error) => app.log.error({ error }, 'scheduled restore drill failed'));
  }, 60 * 60 * 1000).unref();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
