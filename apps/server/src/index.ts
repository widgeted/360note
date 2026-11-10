import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { config, ensureDataDirs } from './config.js';
import { migrate } from './migrate.js';
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
import { recoverInterruptedJobs } from './lib/jobs.js';
import { cleanupImportUploads, runAutoBackups } from './services/backups.js';
import { runInstanceAutoBackup, runScheduledRestoreDrill } from './services/instance-backups.js';

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
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.env === 'production' ? [] : null,
      },
    },
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
    app.log.error({ error, stack: error.stack, url: request.url }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: localize('服务器内部错误') } });
  });


  app.get('/api/public/config', async () => ({
    version: config.version,
    registrationMode: config.registrationMode,
    aiEnabled: config.ai.enabled,
    ocrEnabled: config.ocrEnabled,
    maxUploadBytes: config.maxUploadBytes,
    publicOrigin: config.publicOrigin,
    brand: '360note',
    mailEnabled: Boolean(config.mail.host && config.mail.user && config.mail.pass),
  }));

  app.get('/health', async () => {
    let database = false;
    try {
      await one('SELECT 1 AS ok');
      database = true;
    } catch {
      database = false;
    }
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
    if (fs.existsSync(config.webDist)) {
      return reply.sendFile('index.html');
    }
    return reply.status(503).send('360note web build not found');
  });

  if (fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: '/',
      wildcard: false,
      index: false,
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
  void resumePendingOcr(app.log);
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
