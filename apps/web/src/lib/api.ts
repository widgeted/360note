import { getLocale, translate } from './i18n';

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  rawBody?: BodyInit;
  headers?: Record<string, string>;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const locale = getLocale();
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  headers['Accept-Language'] = locale === 'en' ? 'en' : 'zh-CN';
  headers['X-Locale'] = locale;
  let body: BodyInit | undefined = options.rawBody;
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (!['GET', 'HEAD'].includes(method)) headers['X-360note-CSRF'] = '1';

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      body,
      headers,
      credentials: 'same-origin',
      signal: options.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', translate('网络连接不可用，请检查网络'));
  }

  if (response.status === 204 || response.status === 304) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const payload = data as { error?: { code?: string; message?: string; details?: unknown } } | null;
    const code = payload?.error?.code ?? `HTTP_${response.status}`;
    const isGateway = [502, 503, 504].includes(response.status);
    const message = isGateway
      ? translate('服务暂时不可用，请稍后重试。你的本地草稿与待同步内容不会丢失。')
      : payload?.error?.message ??
        (typeof data === 'string' && !data.trim().startsWith('<') ? data : translate('请求失败'));
    if (response.status === 401 && !path.includes('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('nh:unauthorized'));
    }
    throw new ApiError(response.status, code, message, payload?.error?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE', body }),
  upload: <T>(path: string, form: FormData, options?: { signal?: AbortSignal }) =>
    request<T>(path, { method: 'POST', rawBody: form, signal: options?.signal }),
};

export function downloadUrl(path: string): void {
  const link = document.createElement('a');
  link.href = path;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function downloadBlob(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok) {
    let message = translate('下载失败');
    try {
      const data = await response.json();
      message = data?.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(response.status, 'DOWNLOAD_FAILED', message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
