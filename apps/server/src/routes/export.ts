import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clientIp, requireAuth } from '../auth.js';
import { parse } from '../lib/validate.js';
import { errors } from '../lib/errors.js';
import { workspaceKind } from '../services/workspaces.js';
import { exportSingleNote, exportWorkspace } from '../services/export.js';

export default async function exportRoutes(app: FastifyInstance) {
  app.get('/api/export', async (request, reply) => {
    const auth = requireAuth(request);
    const params = parse(
      z.object({
        workspaceId: z.string().uuid(),
        format: z.enum(['md', 'html', 'json']).default('md'),
      }),
      request.query,
    );
    if ((await workspaceKind(params.workspaceId)) === 'vault') {
      throw errors.forbidden('加密空间内容不可导出');
    }
    await exportWorkspace({
      workspaceId: params.workspaceId,
      userId: auth.user.id,
      format: params.format,
      reply,
      app,
      ip: clientIp(request),
    });
    return reply;
  });
}
