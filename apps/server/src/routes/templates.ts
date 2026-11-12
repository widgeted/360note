import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { parse } from '../lib/validate.js';
import { createTemplate, deleteTemplate, listTemplates, mapTemplate, updateTemplate } from '../services/templates.js';
import { normalizeLocale } from '../lib/mailer.js';

const templateBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(300).optional(),
  titleTemplate: z.string().max(500).optional(),
  contentTemplate: z.string().max(50_000).optional(),
});

export default async function templateRoutes(app: FastifyInstance) {
  app.get('/api/templates', async (request) => {
    const auth = requireAuth(request);
    const locale = normalizeLocale(request.headers['x-locale'] ?? auth.user.prefs?.locale ?? request.headers['accept-language']);
    const rows = await listTemplates(auth.user.id, locale);
    return { templates: rows.map(mapTemplate) };
  });

  app.post('/api/templates', async (request) => {
    const auth = requireAuth(request);
    const body = parse(templateBody, request.body);
    const row = await createTemplate({ userId: auth.user.id, ...body });
    return { template: mapTemplate(row) };
  });

  app.patch('/api/templates/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const body = parse(templateBody.partial(), request.body);
    const row = await updateTemplate({ id, userId: auth.user.id, ...body });
    return { template: mapTemplate(row) };
  });

  app.delete('/api/templates/:id', async (request) => {
    const auth = requireAuth(request);
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    await deleteTemplate(id, auth.user.id);
    return { ok: true };
  });
}
