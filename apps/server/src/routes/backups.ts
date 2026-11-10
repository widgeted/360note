import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { clientIp, requireAuth } from '../auth.js';
import { errors } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireWorkspace } from '../services/workspaces.js';
import { createJob, getJob, runJob } from '../lib/jobs.js';
import {
  backupRecord,
  createBackup,
  deleteBackupRecord,
  listBackups,
  previewBackupFile,
  restoreBackup,
  BACKUP_LIMITS,
  UPLOAD_BACKUP_LIMITS,
} from '../services/backups.js';
import { paths, config } from '../config.js';
import { readBackupToFile, safeFilename } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { getSetting } from '../services/settings.js';

export default async function backupRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:id/backups', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    return { backups: await listBackups(id, auth.user.id) };
  });

  app.post('/api/workspaces/:id/backups', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await requireWorkspace(auth.user.id, id, 'manage');
    const jobId = await createJob('backup-create', { workspaceId: id }, auth.user.id);
    runJob(jobId, async () => {
      try {
        const backup = await createBackup({ workspaceId: id, userId: auth.user.id, kind: 'manual', jobId });
        return { stage: 'done', backup };
      } catch (error) {
        await audit({ workspaceId: id, actorId: auth.user.id, action: 'backup.create.failed', targetType: 'workspace', targetId: id, meta: { jobId, error: (error as Error).message.slice(0, 500) }, ip: clientIp(request) });
        throw error;
      }
    });
    await audit({ workspaceId: id, actorId: auth.user.id, action: 'backup.create', targetType: 'workspace', targetId: id, ip: clientIp(request) });
    return { jobId };
  });

  app.get('/api/backups/:id/download', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { workspaceId } = parse(z.object({ workspaceId: z.string().uuid() }), request.query);
    const record = await backupRecord(id, workspaceId, auth.user.id);
    await requireWorkspace(auth.user.id, workspaceId, 'manage');
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '360note-download-'));
    const decrypted = path.join(tempDir, 'backup.zip');
    try {
      await readBackupToFile(record.filename, decrypted);
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    await audit({ workspaceId, actorId: auth.user.id, action: 'backup.download', targetType: 'backup', targetId: id, ip: clientIp(request) });
    const stream = fsSync.createReadStream(decrypted);
    stream.on('close', () => { void fs.rm(tempDir, { recursive: true, force: true }); });
    stream.on('error', () => { void fs.rm(tempDir, { recursive: true, force: true }); });
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(record.filename.replace(/\.(nhbackup|3nb)$/, '.3nb'))}`)
      .send(stream);
  });

  app.delete('/api/backups/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { workspaceId } = parse(z.object({ workspaceId: z.string().uuid() }), request.query);
    await deleteBackupRecord(id, workspaceId, auth.user.id);
    await audit({ workspaceId, actorId: auth.user.id, action: 'backup.delete', targetType: 'backup', targetId: id, ip: clientIp(request) });
    return { ok: true };
  });

  app.get('/api/backups/:id/preview', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { workspaceId } = parse(z.object({ workspaceId: z.string().uuid() }), request.query);
    const record = await backupRecord(id, workspaceId, auth.user.id);
    await requireWorkspace(auth.user.id, workspaceId, 'manage');
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '360note-preview-'));
    const decrypted = path.join(tempDir, 'backup.zip');
    try {
      await readBackupToFile(record.filename, decrypted);
      return { preview: await previewBackupFile(decrypted, workspaceId, BACKUP_LIMITS) };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  app.post('/api/backups/:id/restore', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const { workspaceId } = parse(z.object({ workspaceId: z.string().uuid() }), request.query);
    const body = parse(z.object({ mode: z.enum(['replace', 'merge']).default('merge') }), request.body ?? {});
    const record = await backupRecord(id, workspaceId, auth.user.id);
    await requireWorkspace(auth.user.id, workspaceId, body.mode === 'replace' ? 'manage' : 'write');
    const jobId = await createJob('backup-restore', { workspaceId, backupId: id, mode: body.mode }, auth.user.id);
    runJob(jobId, async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '360note-restore-'));
      const decrypted = path.join(tempDir, 'backup.zip');
      try {
        await readBackupToFile(record.filename, decrypted);
        return await restoreBackup({ workspaceId, userId: auth.user.id, filePath: decrypted, mode: body.mode, jobId, limits: BACKUP_LIMITS });
      } catch (error) {
        await audit({ workspaceId, actorId: auth.user.id, action: 'backup.restore.failed', targetType: 'backup', targetId: id, meta: { mode: body.mode, jobId, error: (error as Error).message.slice(0, 500) }, ip: clientIp(request) });
        throw error;
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    });
    await audit({ workspaceId, actorId: auth.user.id, action: 'backup.restore', targetType: 'backup', targetId: id, meta: { mode: body.mode }, ip: clientIp(request) });
    return { jobId };
  });

  app.post('/api/workspaces/:id/backups/upload', async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await requireWorkspace(auth.user.id, id, 'manage');
    const part = await request.file({ limits: { fileSize: 600 * 1024 * 1024, files: 1 } });
    if (!part) throw errors.badRequest('请选择备份文件');
    const uploadId = crypto.randomUUID();
    const storedPath = path.join(paths.imports, `upload-${uploadId}.3nb`);
    await fs.mkdir(paths.imports, { recursive: true, mode: 0o700 });
    try {
      await pipeline(part.file, fsSync.createWriteStream(storedPath, { mode: 0o600, flags: 'wx' }));
      if (part.file.truncated) throw errors.payloadTooLarge('备份文件不能超过 600 MB');
    } catch (error) {
      await fs.rm(storedPath, { force: true }).catch(() => {});
      if (error instanceof Error && error.name === 'AppError') throw error;
      throw errors.payloadTooLarge('备份文件不能超过 600 MB');
    }
    let preview;
    try {
      preview = await previewBackupFile(storedPath, id, UPLOAD_BACKUP_LIMITS);
    } catch (error) {
      await fs.rm(storedPath, { force: true });
      await audit({ workspaceId: id, actorId: auth.user.id, action: 'backup.upload.failed', targetType: 'workspace', targetId: id, meta: { error: (error as Error).message.slice(0, 500) }, ip: clientIp(request) });
      throw error;
    }
    const jobId = await createJob(
      'backup-upload',
      { workspaceId: id, uploadId, filename: safeFilename(part.filename), storedPath },
      auth.user.id,
    );
    // Store preview on the job row without a task; the upload is ready for restore.
    const { updateJob } = await import('../lib/jobs.js');
    await updateJob(jobId, { status: 'done', progress: 100, result: { stage: 'preview', preview, uploadId } });
    return reply.send({ uploadId: jobId, preview, filename: part.filename });
  });

  app.post('/api/backups/uploads/:uploadId/restore', async (request) => {
    const auth = requireAuth(request);
    const { uploadId } = parse(z.object({ uploadId: z.string().uuid() }), request.params);
    const body = parse(z.object({ mode: z.enum(['replace', 'merge']).default('merge') }), request.body ?? {});
    const uploadJob = await getJob(uploadId);
    if (!uploadJob || uploadJob.created_by !== auth.user.id || uploadJob.type !== 'backup-upload') {
      throw errors.notFound('上传的备份不存在');
    }
    const payload = uploadJob.payload as { workspaceId: string; storedPath: string };
    await requireWorkspace(auth.user.id, payload.workspaceId, body.mode === 'replace' ? 'manage' : 'write');
    const jobId = await createJob(
      'backup-restore',
      { workspaceId: payload.workspaceId, uploadId, mode: body.mode },
      auth.user.id,
    );
    runJob(jobId, async () => {
      try {
        return await restoreBackup({
          workspaceId: payload.workspaceId,
          userId: auth.user.id,
          filePath: payload.storedPath,
          mode: body.mode,
          jobId,
          limits: UPLOAD_BACKUP_LIMITS,
        });
      } catch (error) {
        await audit({ workspaceId: payload.workspaceId, actorId: auth.user.id, action: 'backup.restore.upload.failed', targetType: 'backup', targetId: uploadId, meta: { mode: body.mode, jobId, error: (error as Error).message.slice(0, 500) }, ip: clientIp(request) });
        throw error;
      } finally {
        await fs.rm(payload.storedPath, { force: true }).catch(() => {});
      }
    });
    await audit({ workspaceId: payload.workspaceId, actorId: auth.user.id, action: 'backup.restore.upload', targetType: 'backup', targetId: uploadId, meta: { mode: body.mode }, ip: clientIp(request) });
    return { jobId };
  });

  // Retention info is surfaced in the UI; values are environment-controlled.
  app.get('/api/backups/retention', async (request) => {
    requireAuth(request);
    const backup = await getSetting<{ retentionDays?: number }>('backup');
    return { retentionDays: Math.max(1, Number(backup?.retentionDays) || config.backupRetentionDays), autoKeep: 14 };
  });
}
