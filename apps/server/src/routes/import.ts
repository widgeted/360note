import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { requireAuth } from '../auth.js';
import { errors } from '../lib/errors.js';
import { withWorkspaceLock } from '../lib/workspace-lock.js';
import { parse } from '../lib/validate.js';
import { requireWorkspace } from '../services/workspaces.js';
import { createJob, getJob, runJob, updateJob } from '../lib/jobs.js';
import { previewFromParsed, parseImport } from '../lib/import-parser.js';
import { cleanupJobDir, safeFilename, tempJobDir } from '../lib/storage.js';
import { executeImport } from '../services/import.js';

const MAX_IMPORT_BYTES = 250 * 1024 * 1024;

export default async function importRoutes(app: FastifyInstance) {
  app.post('/api/import/upload', async (request, reply) => {
    const auth = requireAuth(request);
    const { workspaceId } = parse(z.object({ workspaceId: z.string().uuid() }), request.query);
    await requireWorkspace(auth.user.id, workspaceId, 'write');
    const jobId = await createJob('import-preview', { workspaceId, stage: 'uploading' }, auth.user.id);
    const jobDir = tempJobDir(jobId);
    await fs.mkdir(jobDir, { recursive: true, mode: 0o700 });
    const uploads: Array<{ originalName: string; storedPath: string }> = [];
    let totalBytes = 0;
    try {
      for await (const part of request.parts({
        limits: { fileSize: 120 * 1024 * 1024, files: 40, fields: 10, parts: 60 },
      })) {
        if (part.type !== 'file') continue;
        const filename = `${uploads.length}-${safeFilename(part.filename)}`;
        const storedPath = path.join(jobDir, filename);
        await pipeline(part.file, fsSync.createWriteStream(storedPath, { mode: 0o600, flags: 'wx' }));
        if (part.file.truncated) throw errors.payloadTooLarge('单个导入文件不能超过 120 MB');
        const size = (await fs.stat(storedPath)).size;
        totalBytes += size;
        if (totalBytes > MAX_IMPORT_BYTES) throw errors.payloadTooLarge('一次导入不能超过 250 MB');
        uploads.push({ originalName: part.filename, storedPath });
      }
    } catch (error) {
      await cleanupJobDir(jobId).catch(() => {});
      await updateJob(jobId, { status: 'error', error: (error as Error).message }).catch(() => {});
      if (error instanceof Object && 'statusCode' in error) throw error;
      throw errors.badRequest(`上传失败：${(error as Error).message}`);
    }
    if (!uploads.length) {
      await cleanupJobDir(jobId).catch(() => {});
      await updateJob(jobId, { status: 'error', error: '没有上传文件' }).catch(() => {});
      throw errors.badRequest('请选择要导入的文件');
    }
    await updateJob(jobId, { status: 'running', progress: 2, message: '正在分析导入内容…' });
    runJob(jobId, async () => {
      const parsed = await parseImport({ jobDir, uploads });
      await fs.writeFile(path.join(jobDir, 'parsed.json'), JSON.stringify(parsed), { mode: 0o600 });
      const preview = previewFromParsed(parsed);
      return { stage: 'preview', preview };
    });
    return reply.status(202).send({ jobId, status: 'running' });
  });

  app.get('/api/import/:jobId', async (request) => {
    const auth = requireAuth(request);
    const { jobId } = parse(z.object({ jobId: z.string().uuid() }), request.params);
    const job = await getJob(jobId);
    if (!job || job.created_by !== auth.user.id || job.type !== 'import-preview') throw errors.notFound('导入任务不存在');
    return {
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        message: job.message,
        result: job.result,
        error: job.error,
        createdAt: job.created_at.toISOString(),
        updatedAt: job.updated_at.toISOString(),
      },
    };
  });

  app.post('/api/import/:jobId/execute', async (request, reply) => {
    const auth = requireAuth(request);
    const { jobId } = parse(z.object({ jobId: z.string().uuid() }), request.params);
    const body = parse(z.object({ folderId: z.string().uuid().nullable().optional() }), request.body ?? {});
    const previewJob = await getJob(jobId);
    if (!previewJob || previewJob.created_by !== auth.user.id || previewJob.type !== 'import-preview') {
      throw errors.notFound('导入任务不存在');
    }
    if (previewJob.status !== 'done' || (previewJob.result as { stage?: string } | null)?.stage !== 'preview') {
      throw errors.badRequest('导入内容尚未准备好');
    }
    const payload = previewJob.payload as { workspaceId: string };
    if (!payload.workspaceId) throw errors.badRequest('导入任务缺少工作区');
    await requireWorkspace(auth.user.id, payload.workspaceId, 'write');
    const jobDir = tempJobDir(jobId);
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(jobDir, 'parsed.json'), 'utf8'));
    } catch {
      throw errors.badRequest('导入暂存文件已过期，请重新上传');
    }
    await fs.rm(path.join(jobDir, 'parsed.json'), { force: true });
    const executeJobId = await createJob(
      'import-execute',
      { workspaceId: payload.workspaceId, sourceJobId: jobId },
      auth.user.id,
    );
    runJob(executeJobId, async () => {
      try {
        return await withWorkspaceLock(payload.workspaceId, () => executeImport({
          jobId: executeJobId,
          jobDir,
          userId: auth.user.id,
          workspaceId: payload.workspaceId,
          targetFolderId: body.folderId ?? null,
          parsed,
        }));
      } finally {
        await cleanupJobDir(jobId).catch(() => {});
      }
    });
    return reply.status(202).send({ jobId: executeJobId, status: 'queued' });
  });

  app.get('/api/jobs/:jobId', async (request) => {
    const auth = requireAuth(request);
    const { jobId } = parse(z.object({ jobId: z.string().uuid() }), request.params);
    const job = await getJob(jobId);
    if (!job || job.created_by !== auth.user.id) throw errors.notFound('任务不存在');
    return {
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        message: job.message,
        result: job.result,
        error: job.error,
        createdAt: job.created_at.toISOString(),
        updatedAt: job.updated_at.toISOString(),
      },
    };
  });

  app.get('/api/jobs', async (request) => {
    const auth = requireAuth(request);
    const { many: manyJobs } = await import('../db.js');
    const rows = await manyJobs<{
      id: string;
      type: string;
      status: string;
      progress: number;
      message: string | null;
      result: Record<string, unknown> | null;
      error: string | null;
      created_at: Date;
      updated_at: Date;
    }>('SELECT id, type, status, progress, message, result, error, created_at, updated_at FROM jobs WHERE created_by = $1 ORDER BY created_at DESC LIMIT 20', [auth.user.id]);
    return {
      jobs: rows.map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        progress: row.progress,
        message: row.message,
        result: row.result,
        error: row.error,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  });
}
