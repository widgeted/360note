import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

export type MailLocale = 'zh' | 'en';

let transporter: Transporter | null = null;

export function mailEnabled(): boolean {
  return Boolean(config.mail.host && config.mail.user && config.mail.pass);
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: { user: config.mail.user, pass: config.mail.pass },
      pool: true,
      maxConnections: 3,
      maxMessages: 50,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      tls: { minVersion: 'TLSv1.2', servername: config.mail.host },
    });
  }
  return transporter;
}

export function normalizeLocale(value: unknown): MailLocale {
  return typeof value === 'string' && value.toLowerCase().startsWith('en') ? 'en' : 'zh';
}

function fromHeader(): string {
  const address = config.mail.from || config.mail.user;
  return config.mail.fromName ? `${config.mail.fromName} <${address}>` : address;
}

const RESERVED_MAIL_DOMAINS = new Set([
  'example.com',
  'example.net',
  'example.org',
  'example.edu',
  'localhost',
  'invalid',
  'test',
]);

/**
 * Never send SMTP messages to reserved/test domains. Tests historically
 * created throwaway @invalid.local accounts; those must never leave the box.
 */
export function isReservedMailAddress(address: string): boolean {
  const domain = address.trim().toLowerCase().split('@').pop() ?? '';
  if (!domain) return true;
  if (domain === 'invalid.local' || domain.endsWith('.invalid.local')) return true;
  if (domain.endsWith('.invalid') || domain.endsWith('.test') || domain.endsWith('.example') || domain.endsWith('.localhost')) {
    return true;
  }
  return RESERVED_MAIL_DOMAINS.has(domain);
}

export async function sendMail(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}): Promise<void> {
  if (!mailEnabled()) throw new Error('mail transport is not configured');
  if (isReservedMailAddress(options.to)) throw new Error('refusing to send mail to a reserved/test address');
  await getTransporter().sendMail({
    from: fromHeader(),
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
    replyTo: options.replyTo,
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderMailLayout(locale: MailLocale, title: string, bodyHtml: string): string {
  const brand = locale === 'zh' ? '360笔记' : '360note';
  const site = locale === 'zh' ? 'https://360biji.com' : 'https://360note.com';
  const logoUrl = locale === 'zh' ? 'https://360biji.com/img/360biji-wordmark.png' : 'https://360note.com/img/360note-wordmark.png';
  const logoWidth = locale === 'zh' ? 96 : 108;
  const logoHeight = locale === 'zh' ? 23 : 19;
  const foot =
    locale === 'zh'
      ? '这是一封系统邮件，请勿直接回复。'
      : 'This is an automated message. Please do not reply.';
  return `<!doctype html>
<html lang="${locale === 'zh' ? 'zh-CN' : 'en'}">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f8f6f1;color:#181a1f;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Noto Sans CJK SC','Microsoft YaHei',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6f1;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffefa;border:1px solid #e7e2d8;border-radius:10px;overflow:hidden;">
          <tr><td style="padding:24px 30px 8px 30px;">
            <img src="${logoUrl}" width="${logoWidth}" height="${logoHeight}" alt="${brand}" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:100%;">
          </td></tr>
          <tr><td style="padding:8px 30px 26px 30px;">
            <h1 style="margin:0 0 14px 0;font-size:21px;line-height:1.35;font-weight:650;letter-spacing:-.02em;">${title}</h1>
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:16px 30px;border-top:1px solid #efeae1;font-size:12px;line-height:1.6;color:#8a857b;">
            ${foot}<br><a href="${site}" style="color:#8a857b;text-decoration:none;">${site.replace('https://', '')}</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export async function sendVerificationCode(options: {
  to: string;
  code: string;
  purpose: 'register' | 'recover' | 'change_email';
  locale: MailLocale;
  expiresMinutes: number;
}): Promise<void> {
  const { to, code, purpose, locale, expiresMinutes } = options;
  const zh = locale === 'zh';
  const action = zh
    ? purpose === 'register'
      ? '注册'
      : purpose === 'recover'
        ? '重置密码'
        : '修改邮箱'
    : purpose === 'register'
      ? 'sign up'
      : purpose === 'recover'
        ? 'reset your password'
        : 'change your email address';
  const brand = zh ? '360笔记' : '360note';
  const subject = zh
    ? `${brand} ${action}验证码：${code}`
    : `Your ${brand} verification code: ${code}`;
  const text = zh
    ? `你正在${action} ${brand} 账户。\n\n验证码：${code}\n\n验证码 ${expiresMinutes} 分钟内有效。如果这不是你本人的操作，请忽略这封邮件。`
    : `You are trying to ${action} for your ${brand} account.\n\nVerification code: ${code}\n\nThis code expires in ${expiresMinutes} minutes. If you did not request it, you can safely ignore this email.`;
  const bodyHtml = zh
    ? `<p style="margin:0 0 18px 0;font-size:14px;line-height:1.7;color:#44443f;">你正在${action} ${brand} 账户。请输入下面的验证码：</p>
       <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#181a1f;background:#f8f6f1;border:1px solid #e7e2d8;border-radius:8px;padding:16px 20px;text-align:center;">${escapeHtml(code)}</div>
       <p style="margin:18px 0 0 0;font-size:13px;line-height:1.7;color:#67655f;">验证码 ${expiresMinutes} 分钟内有效。如果这不是你本人的操作，请忽略这封邮件。</p>`
    : `<p style="margin:0 0 18px 0;font-size:14px;line-height:1.7;color:#44443f;">You are trying to ${action} for your ${brand} account. Enter the code below:</p>
       <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#181a1f;background:#f8f6f1;border:1px solid #e7e2d8;border-radius:8px;padding:16px 20px;text-align:center;">${escapeHtml(code)}</div>
       <p style="margin:18px 0 0 0;font-size:13px;line-height:1.7;color:#67655f;">This code expires in ${expiresMinutes} minutes. If you did not request it, you can safely ignore this email.</p>`;
  await sendMail({
    to,
    subject,
    text,
    html: renderMailLayout(locale, zh ? '验证你的邮箱' : 'Verify your email', bodyHtml),
  });
}

export async function sendWelcomeEmail(to: string, displayName: string, locale: MailLocale): Promise<void> {
  const zh = locale === 'zh';
  const brand = zh ? '360笔记' : '360note';
  const subject = zh ? `欢迎来到 ${brand}` : `Welcome to ${brand}`;
  const safeName = escapeHtml(displayName);
  const text = zh
    ? `${displayName}，欢迎来到 ${brand}！\n\n你的账户已经创建成功。现在可以开始记录、整理和分享。\n\n如果这不是你本人的操作，请立即联系我们。`
    : `Hi ${displayName}, welcome to ${brand}!\n\nYour account is ready. Start writing, organizing and sharing.\n\nIf you did not create this account, please contact us immediately.`;
  const bodyHtml = zh
    ? `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#44443f;">${safeName}，欢迎来到 ${brand}！</p>
       <p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#44443f;">你的账户已经创建成功。现在可以开始记录、整理和分享。</p>
       <p style="margin:0;font-size:13px;line-height:1.7;color:#67655f;">如果这不是你本人的操作，请立即联系我们。</p>`
    : `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#44443f;">Hi ${safeName}, welcome to ${brand}!</p>
       <p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#44443f;">Your account is ready. Start writing, organizing and sharing.</p>
       <p style="margin:0;font-size:13px;line-height:1.7;color:#67655f;">If you did not create this account, please contact us immediately.</p>`;
  await sendMail({ to, subject, text, html: renderMailLayout(locale, zh ? '开始使用' : 'Get started', bodyHtml) });
}

export async function sendWorkspaceInviteEmail(options: {
  to: string;
  inviterName: string;
  workspaceName: string;
  role: string;
  url: string;
  locale: MailLocale;
}): Promise<void> {
  const { to, inviterName, workspaceName, role, url, locale } = options;
  const zh = locale === 'zh';
  const brand = zh ? '360笔记' : '360note';
  const subject = zh
    ? `${inviterName} 邀请你加入 ${brand} 的「${workspaceName}」`
    : `${inviterName} invited you to “${workspaceName}” on ${brand}`;
  const safeInviter = escapeHtml(inviterName);
  const safeWorkspace = escapeHtml(workspaceName);
  const safeUrl = escapeHtml(url);
  const text = zh
    ? `${inviterName} 邀请你以 ${role} 身份加入「${workspaceName}」。\n\n打开链接接受邀请：${url}\n\n链接 14 天内有效。如果这不是你期待的邀请，请忽略这封邮件。`
    : `${inviterName} invited you to join “${workspaceName}” as ${role}.\n\nAccept the invitation: ${url}\n\nThis link expires in 14 days. If you were not expecting it, you can ignore this email.`;
  const bodyHtml = zh
    ? `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#44443f;">${safeInviter} 邀请你以 <strong>${escapeHtml(role)}</strong> 身份加入「${safeWorkspace}」。</p>
       <p style="margin:0 0 22px 0;"><a href="${safeUrl}" style="display:inline-block;background:#157a52;color:#fffefa;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:6px;">接受邀请</a></p>
       <p style="margin:0;font-size:13px;line-height:1.7;color:#67655f;">链接 14 天内有效。如果这不是你期待的邀请，请忽略这封邮件。</p>`
    : `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#44443f;">${safeInviter} invited you to join “${safeWorkspace}” as <strong>${escapeHtml(role)}</strong>.</p>
       <p style="margin:0 0 22px 0;"><a href="${safeUrl}" style="display:inline-block;background:#157a52;color:#fffefa;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:6px;">Accept invitation</a></p>
       <p style="margin:0;font-size:13px;line-height:1.7;color:#67655f;">This link expires in 14 days. If you were not expecting it, you can ignore this email.</p>`;
  await sendMail({ to, subject, text, html: renderMailLayout(locale, zh ? '加入空间' : 'Join workspace', bodyHtml) });
}

export async function sendUserExportEmail(options: {
  to: string;
  displayName: string;
  url: string;
  expiresAt: string;
  locale: MailLocale;
}): Promise<void> {
  const { to, displayName, url, expiresAt, locale } = options;
  const zh = locale === 'zh';
  const brand = zh ? '360笔记' : '360note';
  const subject = zh ? `${brand} 数据导出下载链接` : `Your ${brand} data export`;
  const safeUrl = escapeHtml(url);
  const text = zh
    ? `${displayName}，管理员为你准备了一份数据导出。

请在有效期内下载：${url}

有效期至：${expiresAt}
如果这不是你期待的邮件，请忽略。`
    : `${displayName}, an administrator prepared a data export for you.

Download it before it expires: ${url}

Expires: ${expiresAt}
If you were not expecting this, you can ignore this email.`;
  const bodyHtml = zh
    ? `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#44443f;">${escapeHtml(displayName)}，管理员为你准备了一份数据导出。</p>
       <p style="margin:0 0 22px 0;"><a href="${safeUrl}" style="display:inline-block;background:#157a52;color:#fffefa;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:6px;">下载数据</a></p>
       <p style="margin:0;font-size:13px;line-height:1.7;color:#67655f;">有效期至 ${escapeHtml(expiresAt)}。如果这不是你期待的邮件，请忽略。</p>`
    : `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#44443f;">${escapeHtml(displayName)}, an administrator prepared a data export for you.</p>
       <p style="margin:0 0 22px 0;"><a href="${safeUrl}" style="display:inline-block;background:#157a52;color:#fffefa;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:6px;">Download data</a></p>
       <p style="margin:0;font-size:13px;line-height:1.7;color:#67655f;">Expires ${escapeHtml(expiresAt)}. If you were not expecting this, you can ignore this email.</p>`;
  await sendMail({ to, subject, text, html: renderMailLayout(locale, zh ? '数据导出' : 'Data export', bodyHtml) });
}

export async function sendEmailChangedEmail(to: string, newEmail: string, locale: MailLocale): Promise<void> {
  const zh = locale === 'zh';
  const brand = zh ? '360笔记' : '360note';
  const subject = zh ? `${brand} 账户邮箱已修改` : `Your ${brand} account email was changed`;
  const text = zh
    ? `你的 ${brand} 账户登录邮箱已修改为 ${newEmail}。\n\n如果这不是你本人的操作，请立即使用恢复密钥保护账户并联系我们。`
    : `The sign-in email for your ${brand} account was changed to ${newEmail}.\n\nIf you did not do this, secure your account with your recovery key and contact us immediately.`;
  const bodyHtml = zh
    ? `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#44443f;">你的 ${brand} 账户登录邮箱已修改为 <strong>${escapeHtml(newEmail)}</strong>。</p>
       <p style="margin:0;font-size:13px;line-height:1.7;color:#67655f;">如果这不是你本人的操作，请立即使用恢复密钥保护账户并联系我们。</p>`
    : `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#44443f;">The sign-in email for your ${brand} account was changed to <strong>${escapeHtml(newEmail)}</strong>.</p>
       <p style="margin:0;font-size:13px;line-height:1.7;color:#67655f;">If you did not do this, secure your account with your recovery key and contact us immediately.</p>`;
  await sendMail({ to, subject, text, html: renderMailLayout(locale, zh ? '邮箱已修改' : 'Email changed', bodyHtml) });
}

export async function sendPasswordChangedEmail(to: string, locale: MailLocale): Promise<void> {
  const zh = locale === 'zh';
  const brand = zh ? '360笔记' : '360note';
  const subject = zh ? `${brand} 密码已重置` : `Your ${brand} password was reset`;
  const text = zh
    ? `你的 ${brand} 账户密码已通过邮箱验证重置，所有旧会话与两步验证已失效。\n\n如果这不是你本人的操作，请立即使用恢复密钥保护账户并联系我们。`
    : `The password for your ${brand} account was reset via email verification. All previous sessions and two-factor authentication were revoked.\n\nIf you did not do this, secure your account with your recovery key and contact us immediately.`;
  const bodyHtml = zh
    ? `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#44443f;">你的 ${brand} 账户密码已通过邮箱验证重置，所有旧会话与两步验证已失效。</p>
       <p style="margin:0;font-size:13px;line-height:1.7;color:#67655f;">如果这不是你本人的操作，请立即使用恢复密钥保护账户并联系我们。</p>`
    : `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.7;color:#44443f;">The password for your ${brand} account was reset via email verification. All previous sessions and two-factor authentication were revoked.</p>
       <p style="margin:0;font-size:13px;line-height:1.7;color:#67655f;">If you did not do this, secure your account with your recovery key and contact us immediately.</p>`;
  await sendMail({ to, subject, text, html: renderMailLayout(locale, zh ? '密码已重置' : 'Password reset', bodyHtml) });
}
