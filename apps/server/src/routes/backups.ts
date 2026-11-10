import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { clientIp, requireAuth } from '../auth.js';
import { errors } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireWorkspace } from '../services/workspaces.js';
import { createJob, getJob, runJob } from '../lib/jobs.js';
import {
  backupRecord,
  createBackup,
  deleteBackupRecord,
  downloadBackupBuffer,
  listBackups,
  previewBackup,
  restoreBackup,
} from '../services/backups.js';
import { paths, config } from '../config.js';
import { safeFilename } from '../lib/storage.js';
import { audit } from '../lib/audit.js';

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
      const backup = await createBackup({ workspaceId: id, userId: auth.user.id, kind: 'manual', jobId });
      return { stage: 'done', backup };
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
    const buffer = await downloadBackupBuffer(record.filename);
    await audit({ workspaceId, actorId: auth.user.id, action: 'backup.download', targetType: 'backup', targetId: id, ip: clientIp(request) });
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(record.filename.replace(/\.(nhbackup|3nb)$/, '.3nb'))}`)
      .send(buffer);
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
    await requireWorkspace(auth.user.id, workspaceId, 'read');
    const buffer = await downloadBackupBuffer(record.filename);
    return { preview: previewBackup(buffer, workspaceId) };
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
      const buffer = await downloadBackupBuffer(record.filename);
      return restoreBackup({ workspaceId, userId: auth.user.id, buffer, mode: body.mode, jobId });
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
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      throw errors.payloadTooLarge('备份文件不能超过 600 MB');
    }
    const uploadId = crypto.randomUUID();
    const storedPath = path.join(paths.imports, `upload-${uploadId}.3nb`);
    await fs.mkdir(paths.imports, { recursive: true, mode: 0o700 });
    await fs.writeFile(storedPath, buffer, { mode: 0o600 });
    let preview;
    try {
      preview = previewBackup(buffer, id);
    } catch (error) {
      await fs.rm(storedPath, { force: true });
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
        const buffer = await fs.readFile(payload.storedPath);
        return await restoreBackup({
          workspaceId: payload.workspaceId,
          userId: auth.user.id,
          buffer,
          mode: body.mode,
          jobId,
        });
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
    return { retentionDays: config.backupRetentionDays, autoKeep: 14 };
  });
}
