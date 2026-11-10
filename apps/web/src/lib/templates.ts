import { getLocale } from './i18n';

export interface CustomTemplate {
  id: string;
  name: string;
  description: string;
  titleTemplate: string;
  contentTemplate: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateContext {
  user: string;
  workspace: string;
  folder?: string;
  title?: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function templateVariables(now = new Date()): Record<string, string> {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return { date, time, datetime: `${date} ${time}` };
}

export function resolveTemplate(text: string, context: TemplateContext, now = new Date()): string {
  const values: Record<string, string> = {
    ...templateVariables(now),
    user: context.user,
    workspace: context.workspace,
    folder: context.folder ?? '',
    title: context.title ?? '',
  };
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => values[key.toLowerCase()] ?? match);
}

export function applyCustomTemplate(template: CustomTemplate, context: TemplateContext): { title: string; contentMd: string } {
  const base = { ...context, title: '' };
  const title = resolveTemplate(template.titleTemplate, base).trim();
  const contentMd = resolveTemplate(template.contentTemplate, { ...base, title }).trimEnd();
  return { title, contentMd };
}

export function templateDateLabel(now = new Date()): string {
  return new Intl.DateTimeFormat(getLocale() === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
