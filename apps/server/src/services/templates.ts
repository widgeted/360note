import { many, one, query } from '../db.js';
import { errors } from '../lib/errors.js';

export interface TemplateRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  title_template: string;
  content_template: string;
  created_at: Date;
  updated_at: Date;
}

export function mapTemplate(row: TemplateRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    titleTemplate: row.title_template,
    contentTemplate: row.content_template,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listTemplates(userId: string) {
  return many<TemplateRow>(
    'SELECT * FROM templates WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId],
  );
}

export async function createTemplate(input: {
  userId: string;
  name: string;
  description?: string;
  titleTemplate?: string;
  contentTemplate?: string;
}): Promise<TemplateRow> {
  const row = await one<TemplateRow>(
    `INSERT INTO templates (user_id, name, description, title_template, content_template)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      input.userId,
      input.name.trim().slice(0, 120),
      (input.description ?? '').trim().slice(0, 300),
      (input.titleTemplate ?? '').slice(0, 500),
      (input.contentTemplate ?? '').slice(0, 50_000),
    ],
  );
  return row!;
}

export async function updateTemplate(input: {
  id: string;
  userId: string;
  name?: string;
  description?: string;
  titleTemplate?: string;
  contentTemplate?: string;
}): Promise<TemplateRow> {
  const current = await one<TemplateRow>('SELECT * FROM templates WHERE id = $1 AND user_id = $2', [input.id, input.userId]);
  if (!current) throw errors.notFound('模板不存在');
  const row = await one<TemplateRow>(
    `UPDATE templates SET
       name = $3, description = $4, title_template = $5, content_template = $6, updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [
      input.id,
      input.userId,
      input.name === undefined ? current.name : input.name.trim().slice(0, 120),
      input.description === undefined ? current.description : input.description.trim().slice(0, 300),
      input.titleTemplate === undefined ? current.title_template : input.titleTemplate.slice(0, 500),
      input.contentTemplate === undefined ? current.content_template : input.contentTemplate.slice(0, 50_000),
    ],
  );
  return row!;
}

export async function deleteTemplate(id: string, userId: string): Promise<void> {
  await query('DELETE FROM templates WHERE id = $1 AND user_id = $2', [id, userId]);
}
