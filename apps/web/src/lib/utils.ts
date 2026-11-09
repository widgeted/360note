import { format, formatDistanceToNow, isToday, isYesterday, isThisWeek, isThisYear } from 'date-fns';
import { enUS, zhCN } from 'date-fns/locale';
import { getLocale, translate } from './i18n';

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  // One initial reads more calmly in circles at 22–56px than two cramped
  // letters, especially for names like "demo360note.com".
  return trimmed.slice(0, 1).toUpperCase();
}

export function attachmentThumbnailUrl(src: string): string {
  if (!src) return src;
  const isPrivate = /\/api\/attachments\/[0-9a-f-]+\/content/i.test(src);
  const isPublic = /\/api\/public\/shares\/[^/]+\/attachments\/[0-9a-f-]+/i.test(src);
  if (!isPrivate && !isPublic) return src;
  if (/[?&]thumb=1(?:&|$)/i.test(src)) return src;
  return `${src}${src.includes('?') ? '&' : '?'}thumb=1`;
}

export function untitledNoteTitle(createdAt: string | Date = new Date()): string {
  const date = new Date(createdAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return translate('未命名笔记 {date}', { date: stamp });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatNoteDate(iso: string): string {
  const date = new Date(iso);
  const locale = getLocale() === 'en' ? enUS : zhCN;
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return translate('昨天');
  if (isThisWeek(date, { weekStartsOn: 1 })) return format(date, 'EEE', { locale });
  if (isThisYear(date)) return format(date, getLocale() === 'en' ? 'MMM d' : 'M月d日', { locale });
  return format(date, 'yyyy-MM-dd');
}

export function formatFullDate(iso: string): string {
  const date = new Date(iso);
  const locale = getLocale() === 'en' ? enUS : zhCN;
  return format(date, getLocale() === 'en' ? 'MMM d, yyyy HH:mm' : 'yyyy年M月d日 HH:mm', { locale });
}

export function formatPrintDate(iso: string): string {
  const date = new Date(iso);
  const locale = getLocale() === 'en' ? enUS : zhCN;
  return format(date, getLocale() === 'en' ? 'MMM d, yyyy HH:mm' : 'yyyy年MM月dd日 HH:mm', { locale });
}

export function formatRelative(iso: string): string {
  const date = new Date(iso);
  const locale = getLocale() === 'en' ? enUS : zhCN;
  return formatDistanceToNow(date, { addSuffix: true, locale });
}

export function formatRelativeShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return translate('刚刚');
  if (minutes < 60) return translate('{n} 分钟前', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate('{n} 小时前', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return translate('{n} 天前', { n: days });
  return formatNoteDate(iso);
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  }) as T & { cancel: () => void };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

export function wordCount(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const words = text
    .replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
    .replace(/[#*_>`~[\]()|]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + words;
}

export function charCount(text: string): number {
  return [...text].length;
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function modKey(): string {
  return isMac() ? '⌘' : 'Ctrl';
}

export function shortcutLabel(keys: string): string {
  return keys.replaceAll('Mod', modKey()).replaceAll('+', isMac() ? '' : '+');
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
  return Promise.resolve();
}

export function safeSegment(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function emailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function passwordStrength(password: string): { score: number; label: string; tone: 'weak' | 'fair' | 'good' | 'strong' } {
  let score = 0;
  if (password.length >= 10) score += 30;
  if (password.length >= 14) score += 15;
  if (password.length >= 20) score += 10;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 15;
  if (/\d/.test(password)) score += 10;
  if (/[^A-Za-z0-9]/.test(password)) score += 15;
  if (/(.)\1{2,}/.test(password)) score -= 15;
  score = clamp(score, 0, 100);
  if (score < 40) return { score, label: translate('弱'), tone: 'weak' };
  if (score < 65) return { score, label: translate('一般'), tone: 'fair' };
  if (score < 85) return { score, label: translate('良好'), tone: 'good' };
  return { score, label: translate('很强'), tone: 'strong' };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
