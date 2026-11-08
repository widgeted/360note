import { useEffect } from 'react';
import { getLocale } from './i18n';

function brand(): string {
  return getLocale() === 'zh-CN' ? '360笔记' : '360note';
}

function defaultTitle(): string {
  return getLocale() === 'zh-CN'
    ? '360笔记 — 把想法留下，把知识连起来'
    : '360note — Keep ideas, connect knowledge';
}

/**
 * Keeps the browser tab in sync with the current surface. Without this, a tab
 * opened on the landing page keeps saying "360note" while the user is on
 * Settings, a legal page or the 404 screen.
 */
export function useDocumentTitle(title?: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} — ${brand()}` : defaultTitle();
  }, [title]);
}
