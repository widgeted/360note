export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  unauthorized: (message = '请先登录') => new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = '没有权限执行此操作') => new AppError(403, 'FORBIDDEN', message),
  locked: (message = '加密空间已锁定，请输入空间密码') => new AppError(423, 'VAULT_LOCKED', message),
  notFound: (message = '未找到') => new AppError(404, 'NOT_FOUND', message),
  badRequest: (message = '请求无效', details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details),
  conflict: (message = '内容已在其他位置更新', details?: unknown) => new AppError(409, 'CONFLICT', message, details),
  tooMany: (message = '操作过于频繁，请稍后再试') => new AppError(429, 'TOO_MANY_REQUESTS', message),
  payloadTooLarge: (message = '文件过大') => new AppError(413, 'PAYLOAD_TOO_LARGE', message),
  internal: (message = '服务器内部错误') => new AppError(500, 'INTERNAL_ERROR', message),
};

export function errorPayload(error: unknown): { error: { code: string; message: string; details?: unknown } } {
  if (error instanceof AppError) {
    return { error: { code: error.code, message: error.message, details: error.details } };
  }
  return { error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } };
}
